using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using LibraDesktop.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Forms = System.Windows.Forms;
// WinForms is referenced only for the tray NotifyIcon; its global using
// collides with WPF names, so alias every shared type explicitly.
using TextBox = System.Windows.Controls.TextBox;
using Button = System.Windows.Controls.Button;
using StackPanel = System.Windows.Controls.StackPanel;
using TextBlock = System.Windows.Controls.TextBlock;
using Orientation = System.Windows.Controls.Orientation;
using HorizontalAlignment = System.Windows.HorizontalAlignment;
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;

namespace LibraDesktop;

/// <summary>
/// Full-bleed WebView2 window. No toolbar, no log panel: the console UI fills
/// the window and every shell action (update / remote entry / data dir / exit)
/// lives in the tray menu. Closing the window hides it to the tray so the
/// owned local backend keeps collecting callbacks.
/// </summary>
public partial class MainWindow : Window
{
    private readonly BackendProcess _backend = new();
    private AppSettings _settings = new();
    private WebView2? _web;
    private Forms.NotifyIcon? _tray;
    private Forms.ToolStripMenuItem? _updateItem;
    private bool _busy;
    private bool _allowClose;
    private bool _hideHintShown;

    public MainWindow()
    {
        InitializeComponent();
        BuildTray();
    }

    // ── startup ────────────────────────────────────────────────────────────

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        AppPaths.EnsureDirectories();
        _settings = AppSettings.Load();

        await InitWebAsync();

        var payload = PayloadManager.ScanActive();
        if (payload is not null)
        {
            await StartLocalAsync(payload);
        }
        else if (!string.IsNullOrWhiteSpace(_settings.EntryUrl))
        {
            // Remote fallback remembered from a previous session.
            Navigate(_settings.EntryUrl);
        }
        else
        {
            ShowMessagePage(
                "No local backend installed yet",
                "Open the tray menu (Libra Desktop icon) and choose <b>Check Update</b> " +
                "to download the latest backend bundle, or <b>Open Remote Entry</b> to " +
                "connect to a deployed server.");
        }
    }

    private async Task InitWebAsync()
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            _web = new WebView2();
            HostArea.Children.Add(_web);
            await _web.EnsureCoreWebView2Async();
        }
        catch (Exception ex)
        {
            ShowMessagePage(
                "WebView2 runtime is not available",
                "Install the Evergreen WebView2 Runtime and restart Libra Desktop.<br/>" +
                System.Security.SecurityElement.Escape(ex.Message));
        }
    }

    // ── local bundle ───────────────────────────────────────────────────────

    private async Task StartLocalAsync(InstalledPayload payload)
    {
        try
        {
            var ownership = await _backend.StartAsync(payload, log: null);
            if (ownership == BackendOwnership.None)
                return;
            _settings.EntryUrl = payload.EntryUrl;
            _settings.Save();
            Navigate(payload.EntryUrl);
        }
        catch (Exception ex)
        {
            ShowMessagePage(
                "Local backend failed to start",
                System.Security.SecurityElement.Escape(ex.Message) +
                "<br/>Check the tray menu for update/retry actions.");
        }
    }

    // ── navigation ─────────────────────────────────────────────────────────

    private void Navigate(string url)
    {
        if (_web?.CoreWebView2 is null)
        {
            MessageBox.Show(this, "WebView2 is not ready yet.", "Libra Desktop",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        try
        {
            _web.Source = new Uri(url);
        }
        catch (UriFormatException)
        {
            MessageBox.Show(this, $"Invalid URL: {url}", "Libra Desktop",
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private static string NormalizeUrl(string raw)
    {
        var url = raw.Trim();
        if (url.Length == 0)
            return string.Empty;
        if (!url.Contains("://", StringComparison.Ordinal))
            url = "http://" + url;
        return url.TrimEnd('/');
    }

    private void ShowMessagePage(string title, string detail)
    {
        if (_web is null)
            return;
        var html = $$"""
            <!doctype html><html><head><meta charset="utf-8">
            <style>
              body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#12161c;color:#dfe6ee;font-family:'Segoe UI',system-ui,sans-serif}
              div{text-align:center;max-width:560px;padding:24px}
              h1{font-size:20px;font-weight:600;margin:0 0 10px}
              p{color:#9aa7b4;font-size:14px;line-height:1.7;margin:0}
              b{color:#7dd3fc;font-weight:600}
            </style></head>
            <body><div><h1>{{title}}</h1><p>{{detail}}</p></div></body></html>
            """;
        _web.NavigateToString(html);
    }

    // ── tray ───────────────────────────────────────────────────────────────

    private void BuildTray()
    {
        _tray = new Forms.NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application,
            Text = "Libra Desktop",
            Visible = true,
        };

        var showItem = new Forms.ToolStripMenuItem("Open Libra Desktop");
        showItem.Click += (_, _) => ShowWindow();

        _updateItem = new Forms.ToolStripMenuItem("Check Update");
        _updateItem.Click += async (_, _) => await RunUpdateAsync();

        var remoteItem = new Forms.ToolStripMenuItem("Open Remote Entry...");
        remoteItem.Click += (_, _) => PromptRemoteEntry();

        var dataItem = new Forms.ToolStripMenuItem("Open Data Directory");
        dataItem.Click += (_, _) =>
        {
            Process.Start(new ProcessStartInfo("explorer.exe", AppPaths.DataDir) { UseShellExecute = true });
        };

        var exitItem = new Forms.ToolStripMenuItem("Exit");
        exitItem.Click += async (_, _) => await ExitAsync();

        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add(showItem);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(_updateItem);
        menu.Items.Add(remoteItem);
        menu.Items.Add(dataItem);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(exitItem);
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => ShowWindow();
    }

    private void ShowWindow()
    {
        Show();
        if (WindowState == WindowState.Minimized)
            WindowState = WindowState.Normal;
        Activate();
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_allowClose)
            return;
        // Tray app: closing hides, the local backend keeps running.
        e.Cancel = true;
        Hide();
        if (!_hideHintShown)
        {
            _hideHintShown = true;
            _tray?.ShowBalloonTip(3000, "Libra Desktop is still running",
                "It stays in the tray so the local backend keeps collecting callbacks. " +
                "Use the tray icon to exit.", Forms.ToolTipIcon.Info);
        }
    }

    private async Task ExitAsync()
    {
        _allowClose = true;
        _tray?.Dispose();
        await _backend.StopAsync();
        System.Windows.Application.Current.Shutdown();
    }

    // ── update / remote entry ──────────────────────────────────────────────

    private async Task RunUpdateAsync()
    {
        if (_busy)
            return;
        _busy = true;
        if (_updateItem is not null)
            _updateItem.Enabled = false;
        try
        {
            // Replacing files under a running owned backend would fail on Windows;
            // remember it so a failed update can bring it straight back.
            var ownedPayload = _backend.Ownership == BackendOwnership.Owned
                ? PayloadManager.ScanActive()
                : null;
            if (ownedPayload is not null)
                await _backend.StopAsync();

            var updater = new GitHubUpdater(_settings.GitHub, new Progress<string>(_ => { }));
            var outcome = await updater.CheckAndInstallAsync();

            if (outcome == UpdateOutcome.Installed)
            {
                var payload = PayloadManager.ScanActive();
                if (payload is not null)
                {
                    await StartLocalAsync(payload);
                    MessageBox.Show(this,
                        $"Installed backend tag {payload.Manifest.Tag}.",
                        "Libra Desktop", MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            else
            {
                var tag = PayloadManager.ScanActive()?.Manifest.Tag ?? "unknown";
                MessageBox.Show(this, $"Already on the latest backend tag ({tag}).",
                    "Libra Desktop", MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Update failed:\n{ex.Message}",
                "Libra Desktop", MessageBoxButton.OK, MessageBoxImage.Error);
            var payload = PayloadManager.ScanActive();
            if (payload is not null && _backend.Ownership == BackendOwnership.None)
                await StartLocalAsync(payload);
        }
        finally
        {
            _busy = false;
            if (_updateItem is not null)
                _updateItem.Enabled = true;
        }
    }

    private void PromptRemoteEntry()
    {
        var input = new TextBox
        {
            Text = _settings.EntryUrl ?? "http://127.0.0.1:5270",
            Padding = new Thickness(4),
        };
        input.KeyDown += (_, e) =>
        {
            if (e.Key == Key.Enter)
                input.Tag = "ok";
        };

        var connectButton = new Button { Content = "Open", Width = 80, IsDefault = true };
        var cancelButton = new Button { Content = "Cancel", Width = 80, Margin = new Thickness(6, 0, 0, 0) };

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 14, 0, 0),
        };
        buttons.Children.Add(connectButton);
        buttons.Children.Add(cancelButton);

        var panel = new StackPanel { Margin = new Thickness(14) };
        panel.Children.Add(new TextBlock
        {
            Text = "Console / server entry URL",
            Margin = new Thickness(0, 0, 0, 6),
            Foreground = System.Windows.Media.Brushes.Gray,
        });
        panel.Children.Add(input);
        panel.Children.Add(buttons);

        var dialog = new Window
        {
            Title = "Open Remote Entry",
            Owner = this,
            Width = 460,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            ResizeMode = ResizeMode.NoResize,
            ShowInTaskbar = false,
            Content = panel,
        };

        string? result = null;
        connectButton.Click += (_, _) => { result = input.Text; dialog.Close(); };
        cancelButton.Click += (_, _) => dialog.Close();
        input.KeyDown += (_, e) =>
        {
            if (e.Key == Key.Enter)
                { result = input.Text; dialog.Close(); }
        };

        dialog.ShowDialog();

        var url = NormalizeUrl(result ?? string.Empty);
        if (url.Length == 0)
            return;
        _settings.EntryUrl = url;
        _settings.Save();
        Navigate(url);
    }
}