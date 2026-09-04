using System.Diagnostics;
using System.IO;
using System.Net.Http;

namespace LibraDesktop.Core;

public enum BackendOwnership
{
    /// <summary>No backend is running for the requested port.</summary>
    None,
    /// <summary>A backend is already serving the port (external process, never killed).</summary>
    External,
    /// <summary>The backend was started by this shell and will be stopped with it.</summary>
    Owned,
}

/// <summary>
/// Starts/stops the bundled backend process and probes its readiness.
/// Probing mirrors the console's pingBackend: 200/401/500 mean "alive".
/// </summary>
public sealed class BackendProcess
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(2) };

    private Process? _process;

    public BackendOwnership Ownership { get; private set; } = BackendOwnership.None;

    /// <summary>Poll the readiness endpoint of a local backend.</summary>
    public static async Task<bool> IsAliveAsync(int port)
    {
        try
        {
            using var resp = await Http.GetAsync($"http://127.0.0.1:{port}/api/auth/status");
            return resp.StatusCode is
                System.Net.HttpStatusCode.OK or
                System.Net.HttpStatusCode.Unauthorized or
                System.Net.HttpStatusCode.InternalServerError;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) { return false; }
    }

    /// <summary>
    /// Start the payload backend unless something already serves its port.
    /// When an external backend is detected it is adopted (External) and never killed.
    /// </summary>
    public async Task<BackendOwnership> StartAsync(InstalledPayload payload, IProgress<string>? log = null)
    {
        await StopAsync();

        var port = payload.Manifest.Port;
        if (await IsAliveAsync(port))
        {
            Ownership = BackendOwnership.External;
            log?.Report($"Backend already active on port {port} (external, adopted).");
            return Ownership;
        }

        var psi = new ProcessStartInfo
        {
            FileName = payload.BackendExe,
            WorkingDirectory = payload.RootDir,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        log?.Report($"Starting backend {Path.GetFileName(payload.BackendExe)} on port {port} ...");
        _process = Process.Start(psi)
            ?? throw new InvalidOperationException("failed to start backend process");

        // Self-contained single-file payloads unpack on first run; allow up to 60s.
        for (var i = 0; i < 120; i++)
        {
            await Task.Delay(500);
            if (_process.HasExited)
            {
                var code = _process.ExitCode;
                _process = null;
                Ownership = BackendOwnership.None;
                throw new InvalidOperationException($"backend exited early with code {code}");
            }
            if (await IsAliveAsync(port))
            {
                Ownership = BackendOwnership.Owned;
                log?.Report($"Backend ready on http://127.0.0.1:{port}/");
                return Ownership;
            }
        }

        await StopAsync();
        throw new TimeoutException($"backend did not become ready on port {port} within 60s");
    }

    /// <summary>Stop only a backend this shell started.</summary>
    public async Task StopAsync()
    {
        if (_process is null)
            return;
        var proc = _process;
        _process = null;
        Ownership = BackendOwnership.None;
        try
        {
            if (!proc.HasExited)
            {
                proc.Kill(entireProcessTree: true);
                await proc.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            }
        }
        catch (InvalidOperationException) { /* already gone */ }
        catch (Exception ex)
        {
            Debug.WriteLine($"backend stop failed: {ex.Message}");
        }
    }
}

