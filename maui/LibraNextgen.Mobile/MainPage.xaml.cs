using LibraNextgen.Mobile.Services;

namespace LibraNextgen.Mobile;

/// <summary>
/// The app's only page: a full-bleed WebView hosting the console.
///
/// There is deliberately no native UI beyond this. The boot screen is HTML
/// shipped in the app package (<c>Resources/Raw/boot.html</c>) and lives in the
/// same WebView, so the whole user experience — including account creation and
/// the loading/failure states — is the React app.
/// </summary>
public partial class MainPage : ContentPage
{
    /// <summary>Custom scheme the boot page uses to ask for a restart.</summary>
    private const string RetryScheme = "libra-retry:";

    private bool _started;

    public MainPage()
    {
        InitializeComponent();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        MobileBridge.Attach(Browser);
        // The hardware/gesture back press is routed through here.
        WebNavigation.Register(Browser);

        // Match the backdrop to the device appearance before the first paint, so
        // the loading screen never flashes the opposite theme.
        ApplyInitialBackdrop();

        if (_started)
            return;
        _started = true;

        await LoadBootPageAsync();
        await StartServiceAsync();
    }

    private void ApplyInitialBackdrop()
    {
        var light = Application.Current?.RequestedTheme == AppTheme.Light;
        var color = Color.FromArgb(light ? "#FFFDF9" : "#0B0F14");
        BackgroundColor = color;
        Browser.BackgroundColor = color;
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        MobileBridge.Detach();
        WebNavigation.Register(null);
    }

    /// <summary>Load the packaged boot screen; the service is not up yet.</summary>
    private async Task LoadBootPageAsync()
    {
        try
        {
            using var stream = await FileSystem.OpenAppPackageFileAsync("boot.html");
            using var reader = new StreamReader(stream);
            Browser.Source = new HtmlWebViewSource { Html = await reader.ReadToEndAsync() };
        }
        catch (Exception ex)
        {
            AppLog.Error("boot page load failed", ex);
            Browser.Source = new HtmlWebViewSource
            {
                Html = "<html><body style=\"background:#0b0f14;color:#f87171;font-family:sans-serif;padding:24px\">"
                       + "启动页加载失败，请重新安装应用。</body></html>",
            };
        }
    }

    /// <summary>
    /// Bring the embedded service up and hand the console URL to the boot page.
    /// Failures are reported inside the page so the user gets a reason and a
    /// retry action instead of a blank screen.
    /// </summary>
    private async Task StartServiceAsync()
    {
        try
        {
            await LocalServiceHost.Instance.StartAsync();
            MobileBridge.PushReady(LocalServiceHost.Instance.BaseUrl);
        }
        catch (Exception ex)
        {
            AppLog.Error("local service start failed", ex);
            MobileBridge.PushFailure(ex.Message);
        }
    }

    private async void OnBrowserNavigating(object? sender, WebNavigatingEventArgs e)
    {
        if (e.Url?.StartsWith(RetryScheme, StringComparison.OrdinalIgnoreCase) != true)
            return;

        // The boot page's retry action; never let the WebView try to load it.
        e.Cancel = true;
        MobileBridge.PushStatus("正在重启本地服务…");
        await StartServiceAsync();
    }

    private void OnBrowserNavigated(object? sender, WebNavigatedEventArgs e)
    {
        if (e.Result != WebNavigationResult.Success)
            return;

        // The document was replaced: re-apply the system-bar insets and make the
        // bridge available to the console's scripts.
        MobileBridge.ReapplyAsync(Browser);
    }
}
