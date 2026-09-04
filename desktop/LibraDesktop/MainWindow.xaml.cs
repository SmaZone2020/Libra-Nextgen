using System.IO;
using System.Windows;
using System.Windows.Input;
using LibraDesktop.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace LibraDesktop;

/// <summary>
/// Shell orchestration: local bundle startup / remote entry navigation.
/// The console UI itself is just the web page inside the WebView2 host.
/// </summary>
public partial class MainWindow : Window
{
    private readonly BackendProcess _backend = new();
    private AppSettings _settings = new();
    private WebView2? _web;
    private bool _busy;

    public MainWindow()
    {
        InitializeComponent();
        Closed += (_, _) => _ = _backend.StopAsync();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        AppPaths.EnsureDirectories();
        _settings = AppSettings.Load();
        EntryUrl.Text = _settings.EntryUrl ?? string.Empty;
        SetStatus("Initializing WebView2 ...");

        await InitWebAsync();

        var payload = PayloadManager.ScanActive();
        if (payload is not null)
        {
            Log($"Local bundle found: tag {payload.Manifest.Tag}, backend {Path.GetFileName(payload.BackendExe)}");
            await StartLocalAsync(payload);
            return;
        }

        if (!string.IsNullOrWhiteSpace(_settings.EntryUrl))
        {
            Navigate(_settings.EntryUrl);
        }
        else
        {
            SetStatus("No local bundle and no saved entry. Enter a server URL and press Connect, " +
                      "or press Check Update to install the latest local backend bundle.");
            Log("First run: paste the console URL of a deployed server, or press Check Update " +
                "to pull the latest local backend bundle from GitHub.");
        }
    }

    private async Task InitWebAsync()
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            Log($"WebView2 runtime: {version}");
            _web = new WebView2();
            HostArea.Children.Add(_web);
            await _web.EnsureCoreWebView2Async();
            SetStatus("WebView2 ready.");
        }
        catch (Exception ex)
        {
            SetStatus("WebView2 runtime is not available. Install the Evergreen WebView2 Runtime and restart.", isError: true);
            Log(ex.Message);
        }
    }

    private void OnConnectClick(object sender, RoutedEventArgs e) => ConnectTo(EntryUrl.Text);

    private void OnEntryKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
            ConnectTo(EntryUrl.Text);
    }

    private async void OnUpdateClick(object sender, RoutedEventArgs e)
    {
        if (_busy)
            return;
        _busy = true;
        SetButtonsEnabled(false);
        // Replacing files under a running owned backend would fail on Windows;
        // remember it so a failed update can bring it straight back.
        var ownedPayload = _backend.Ownership == BackendOwnership.Owned
            ? PayloadManager.ScanActive()
            : null;
        if (ownedPayload is not null)
            await _backend.StopAsync();
        try
        {
            var updater = new GitHubUpdater(_settings.GitHub, new Progress<string>(Log));
            var outcome = await updater.CheckAndInstallAsync();

            if (outcome == UpdateOutcome.Installed)
            {
                var payload = PayloadManager.ScanActive();
                if (payload is not null)
                    await StartLocalAsync(payload);
            }
        }
        catch (Exception ex)
        {
            Log($"Update failed: {ex.Message}");
            SetStatus("Update failed — see log.", isError: true);
            if (ownedPayload is not null)
                await StartLocalAsync(ownedPayload);
        }
        finally
        {
            _busy = false;
            SetButtonsEnabled(true);
        }
    }

    private void ConnectTo(string rawUrl)
    {
        var url = NormalizeUrl(rawUrl);
        if (url.Length == 0)
        {
            SetStatus("Enter an entry URL first.", isError: true);
            return;
        }
        _settings.EntryUrl = url;
        _settings.Save();
        Navigate(url);
    }

    private async Task StartLocalAsync(InstalledPayload payload)
    {
        try
        {
            var ownership = await _backend.StartAsync(payload, new Progress<string>(Log));
            if (ownership == BackendOwnership.None)
                return;
            _settings.EntryUrl = payload.EntryUrl;
            _settings.Save();
            Navigate(payload.EntryUrl);
        }
        catch (Exception ex)
        {
            SetStatus("Local backend failed to start.", isError: true);
            Log($"Local backend failed: {ex.Message}");
        }
    }

    private void Navigate(string url)
    {
        if (_web?.CoreWebView2 is null)
        {
            SetStatus("Cannot navigate: WebView2 not ready.", isError: true);
            return;
        }
        try
        {
            var uri = new Uri(url);
            _web.Source = uri;
            SetStatus($"Viewing {url}");
            Log($"Navigating to {url}");
        }
        catch (UriFormatException)
        {
            SetStatus($"Invalid URL: {url}", isError: true);
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

    private void SetStatus(string text, bool isError = false)
    {
        StatusText.Text = text;
        StatusText.Foreground = isError
            ? System.Windows.Media.Brushes.Firebrick
            : System.Windows.Media.Brushes.DimGray;
    }

    private void Log(string line)
    {
        LogBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {line}{Environment.NewLine}");
        LogBox.ScrollToEnd();
    }

    private void SetButtonsEnabled(bool enabled)
    {
        ConnectButton.IsEnabled = enabled;
        UpdateButton.IsEnabled = enabled;
    }
}

