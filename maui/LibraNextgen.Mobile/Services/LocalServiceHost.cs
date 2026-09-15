using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using LibraNextgen.Service;
using Microsoft.Extensions.Logging;

namespace LibraNextgen.Mobile.Services;

/// <summary>
/// The mobile equivalent of the Electron shell's <c>ServiceProcess</c>.
///
/// The desktop shell spawns the .NET service as a child process; a mobile app
/// cannot spawn one, so the very same <see cref="LibraServiceHost"/> runs inside
/// the app process instead. Everything around it is deliberately the same
/// contract as the desktop shell:
///
/// <list type="bullet">
/// <item>state lives in the app data directory (Electron: <c>--user-data-dir</c>);</item>
/// <item>a generated <c>libra.conf.json</c> is the single source of truth;</item>
/// <item>the port is chosen by scanning up from 5270 so a busy port never breaks startup;</item>
/// <item>readiness mirrors the shell probe: <c>/api/auth/status</c> answering 200/401/500 means alive;</item>
/// <item>the console SPA is served by the service itself (<c>LIBRA_WEB_ROOT</c>).</item>
/// </list>
///
/// The one intentional difference: storage is <b>SQLite, always</b>. Mobile has no
/// storage picker and no MongoDB path — the user never has to know how data is
/// stored, it just is.
/// </summary>
public sealed class LocalServiceHost
{
    public static LocalServiceHost Instance { get; } = new();

    private readonly SemaphoreSlim _gate = new(1, 1);
    private CancellationTokenSource? _cts;
    private Task? _runTask;

    private LocalServiceHost()
    {
    }

    public int Port { get; private set; } = MobileServiceLayout.PreferredPort;

    public string BaseUrl => $"http://127.0.0.1:{Port}/";

    public bool IsRunning => _runTask is { IsCompleted: false };

    /// <summary>Set when the embedded host stopped because of an error.</summary>
    public string? LastError { get; private set; }

    /// <summary>
    /// Bring the local service up: data directories, console bundle, free port,
    /// config, then the in-process host and its readiness probe. Safe to call
    /// again (restart) — the previous instance is stopped first.
    /// </summary>
    public async Task StartAsync(IProgress<string>? progress = null, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await StopAsync();

            LastError = null;

            progress?.Report("准备数据目录");
            MobileServiceLayout.EnsureDirectories();
            AppLog.Info($"data directory: {MobileServiceLayout.DataRoot}");

            progress?.Report("解包控制台资源");
            await WebBundleProvisioner.EnsureExtractedAsync(cancellationToken);

            progress?.Report("选择本地端口");
            Port = await FindFreePortAsync(MobileServiceLayout.PreferredPort, cancellationToken);
            AppLog.Info($"local service port: {Port}");

            // The config file is the same contract the desktop shell owns; mobile
            // pins it to SQLite and loopback so the console has nothing to ask the
            // user about storage.
            await WriteConfigAsync(Port, cancellationToken);

            progress?.Report("启动本地服务");
            ApplyEnvironment();

            _cts = new CancellationTokenSource();
            var token = _cts.Token;
            _runTask = Task.Run(async () =>
            {
                try
                {
                    AppLog.Info("embedded service starting");
                    await LibraServiceHost.RunAsync(
                        ["--user-data-dir", MobileServiceLayout.DataRoot, "--store", "sqlite",
                         "--dbpath", MobileServiceLayout.DatabasePath],
                        token);
                    AppLog.Info("embedded service stopped");
                }
                catch (OperationCanceledException)
                {
                    AppLog.Info("embedded service cancelled");
                }
                catch (Exception ex)
                {
                    LastError = ex.Message;
                    AppLog.Error("embedded service crashed", ex);
                }
            }, token);

            progress?.Report("等待服务就绪");
            await WaitUntilReadyAsync(cancellationToken);

            progress?.Report("就绪");
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Stop the embedded service (app shutdown / restart).</summary>
    public async Task StopAsync()
    {
        var cts = _cts;
        var task = _runTask;
        _cts = null;
        _runTask = null;

        if (cts is null)
            return;

        try
        {
            cts.Cancel();
            if (task is not null)
                await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(5)));
        }
        catch
        {
            // Best effort: the process is going away anyway.
        }
        finally
        {
            cts.Dispose();
        }
    }

    /// <summary>
    /// Writes the mobile service configuration. Storage is hardwired to SQLite:
    /// no mode switch, no connection string, no user-facing choice.
    /// </summary>
    private static async Task WriteConfigAsync(int port, CancellationToken cancellationToken)
    {
        var config = new
        {
            schemaVersion = 1,
            storage = new
            {
                mode = "sqlite",
                connectString = "",
                dbPath = MobileServiceLayout.DatabasePath,
            },
            listener = new
            {
                port,
                bindLoopback = true,
            },
            desktop = new
            {
                closeBehavior = "quit",
            },
        };

        var json = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });
        var temp = MobileServiceLayout.ConfigPath + ".tmp";
        await File.WriteAllTextAsync(temp, json, cancellationToken);
        // Atomic replace: the service reads this file at startup only.
        File.Move(temp, MobileServiceLayout.ConfigPath, overwrite: true);
        AppLog.Info($"wrote {MobileServiceLayout.ConfigPath} (sqlite, port {port})");
    }

    /// <summary>
    /// Environment contract shared with the desktop shell. Process-wide managed
    /// environment variables are enough because the service runs in this process.
    /// </summary>
    private static void ApplyEnvironment()
    {
        Environment.SetEnvironmentVariable("LIBRA_WEB_ROOT", MobileServiceLayout.WebRoot);
        Environment.SetEnvironmentVariable("LIBRA_USER_DATA_DIR", MobileServiceLayout.DataRoot);
        Environment.SetEnvironmentVariable("LIBRA_SERVER_KEY", MobileServiceLayout.ServerKeyPath);
        Environment.SetEnvironmentVariable("LIBRA_EMBEDDED_HOST", "1");
        // The builder derives its output root from the assembly location, which on
        // Android lands on the read-only filesystem root ("/data/build-output").
        // Point it at the app's private storage instead.
        Environment.SetEnvironmentVariable("LIBRA_BUILDS_DIR", MobileServiceLayout.BuildOutputRoot);
        Environment.SetEnvironmentVariable("LIBRA_START_DELAY_MS", null);
    }

    /// <summary>
    /// Scan up from <paramref name="start"/> for a free loopback port, mirroring
    /// the shell's <c>firstFreePort</c>. The socket is released afterwards, so
    /// Kestrel binds it a moment later — the same small race the desktop accepts.
    /// </summary>
    private static async Task<int> FindFreePortAsync(int start, CancellationToken cancellationToken)
    {
        for (var port = start; port < Math.Min(start + 50, IPEndPoint.MaxPort); port++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (await IsPortFreeAsync(port))
                return port;
            AppLog.Warn($"port {port} is busy, trying next");
        }
        throw new InvalidOperationException($"no free port found between {start} and {start + 50}");
    }

    private static async Task<bool> IsPortFreeAsync(int port)
    {
        try
        {
            var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            await Task.Yield();
            listener.Stop();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    /// <summary>Poll the service until it answers, mirroring the shell's readiness probe.</summary>
    private async Task WaitUntilReadyAsync(CancellationToken cancellationToken)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        for (var attempt = 0; attempt < 240; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (_runTask is { IsCompleted: true })
                throw new InvalidOperationException(
                    LastError ?? "the local service stopped before it became ready");

            try
            {
                using var response = await client.GetAsync($"{BaseUrl}api/auth/status", cancellationToken);
                if (response.StatusCode is HttpStatusCode.OK or HttpStatusCode.Unauthorized
                    or HttpStatusCode.InternalServerError)
                {
                    AppLog.Info($"local service ready on {BaseUrl}");
                    return;
                }
            }
            catch (Exception)
            {
                // not listening yet
            }

            await Task.Delay(250, cancellationToken);
        }

        throw new TimeoutException($"the local service did not become ready on {BaseUrl} within 60s");
    }
}
