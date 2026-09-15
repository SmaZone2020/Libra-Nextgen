namespace LibraNextgen.Mobile.Services;

/// <summary>
/// Back-press routing for the console.
///
/// The console is a single-page app, so the WebView's own history stack is not a
/// reliable "can we go back inside the app?" signal: the router pushes entries
/// the host cannot see. The console therefore pushes its in-app depth here (see
/// <c>initNavDepthReporting</c> in the web app) and the back press is answered
/// from that number, which is what makes Back behave like the browser's.
/// </summary>
public static class WebNavigation
{
    private static WeakReference<WebView>? _active;

    /// <summary>In-app history depth reported by the console.</summary>
    public static int NavDepth { get; private set; }

    public static void Register(WebView? webView) =>
        _active = webView is null ? null : new WeakReference<WebView>(webView);

    public static void SetNavDepth(int depth) => NavDepth = Math.Max(0, depth);

    /// <summary>True when the back press was consumed by the console.</summary>
    public static bool TryGoBack()
    {
        if (_active?.TryGetTarget(out var webView) != true)
            return false;

        // The SPA is deeper than its entry point: let the router handle it so
        // the page state (keep-alive panels, scroll) survives the navigation.
        if (NavDepth > 0)
        {
            _ = webView.EvaluateJavaScriptAsync("window.history.back();");
            return true;
        }

        // Fallback for anything the router did not report (boot screen, external
        // pages): plain WebView history.
        try
        {
            if (webView.CanGoBack)
            {
                webView.GoBack();
                return true;
            }
        }
        catch
        {
            // Handler not ready — fall through and let the app close.
        }

        return false;
    }
}
