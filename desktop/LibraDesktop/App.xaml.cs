using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Threading;
using LibraDesktop.Core;
// UseWindowsForms adds a global using for System.Windows.Forms; alias the
// types this file shares with WPF to keep calls unambiguous.
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;

namespace LibraDesktop;

public partial class App : System.Windows.Application
{
    private const string MutexName = @"Local\LibraDesktop.SmaZone2020";
    private Mutex? _mutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        // Single instance: a second launch just tells the user and exits.
        _mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        if (!createdNew)
        {
            MessageBox.Show("Libra Desktop is already running.", "Libra Desktop",
                MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            WriteCrashLog(args.ExceptionObject?.ToString() ?? "unknown error");

        base.OnStartup(e);
        new MainWindow().Show();
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        WriteCrashLog(e.Exception.ToString());
        MessageBox.Show($"Unexpected error:\n{e.Exception.Message}\n\nDetails were written to {AppPaths.LogsDir}.",
            "Libra Desktop", MessageBoxButton.OK, MessageBoxImage.Error);
        e.Handled = true;
    }

    private static void WriteCrashLog(string detail)
    {
        try
        {
            AppPaths.EnsureDirectories();
            var file = Path.Combine(AppPaths.LogsDir, $"crash-{DateTime.Now:yyyyMMdd-HHmmss}.log");
            File.WriteAllText(file, detail);
        }
        catch
        {
            // Last resort: nothing sane left to do.
        }
    }
}
