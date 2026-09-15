using System.Collections.Concurrent;
using System.Text;
using Microsoft.Extensions.Logging;

namespace LibraNextgen.Mobile.Services;

/// <summary>
/// Small in-app log: the mobile app has no console, so the service's own log
/// output is captured here and shown/copied from the settings page. Bounded ring
/// buffer in memory plus a rolling file under the app data directory.
/// </summary>
public static class AppLog
{
    private const int MaxEntries = 800;
    private const long MaxFileBytes = 2 * 1024 * 1024;

    private static readonly ConcurrentQueue<string> Entries = new();
    private static readonly object FileLock = new();

    public static event Action? Changed;

    public static void Write(string level, string message)
    {
        var line = $"{DateTime.Now:HH:mm:ss.fff} [{level}] {message}";
        Entries.Enqueue(line);
        while (Entries.Count > MaxEntries && Entries.TryDequeue(out _)) { }

        try
        {
            lock (FileLock)
            {
                Directory.CreateDirectory(MobileServiceLayout.LogDirectory);
                var info = new FileInfo(MobileServiceLayout.AppLogPath);
                if (info.Exists && info.Length > MaxFileBytes)
                    File.Move(MobileServiceLayout.AppLogPath, MobileServiceLayout.AppLogPath + ".1", overwrite: true);
                File.AppendAllText(MobileServiceLayout.AppLogPath, line + Environment.NewLine, Encoding.UTF8);
            }
        }
        catch
        {
            // Logging must never take the app down.
        }

        Changed?.Invoke();
    }

    public static void Info(string message) => Write("info", message);

    public static void Warn(string message) => Write("warn", message);

    public static void Error(string message, Exception? ex = null) =>
        Write("error", ex is null ? message : $"{message}: {ex.GetType().Name}: {ex.Message}");

    public static string Snapshot() => string.Join(Environment.NewLine, Entries.ToArray());

    public static void Clear()
    {
        while (Entries.TryDequeue(out _)) { }
        try
        {
            File.Delete(MobileServiceLayout.AppLogPath);
        }
        catch
        {
        }
        Changed?.Invoke();
    }
}

/// <summary>Bridges <c>ILogger</c> output from the embedded service into <see cref="AppLog"/>.</summary>
public sealed class AppLogLoggerProvider : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new AppLogLogger(categoryName);

    public void Dispose()
    {
    }

    private sealed class AppLogLogger(string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
                return;

            // Framework chatter (Kestrel/Hosting/Microsoft.*) is noise in a mobile log view;
            // keep the service's own categories and anything at warning or above.
            if (logLevel < LogLevel.Warning && category.StartsWith("Microsoft.", StringComparison.Ordinal))
                return;

            var message = formatter(state, exception);
            if (exception is not null)
                message = $"{message} ({exception.GetType().Name}: {exception.Message})";
            AppLog.Write(logLevel.ToString().ToLowerInvariant(), $"{Short(category)}: {message}");
        }

        private static string Short(string category)
        {
            var idx = category.LastIndexOf('.');
            return idx >= 0 && idx < category.Length - 1 ? category[(idx + 1)..] : category;
        }
    }
}
