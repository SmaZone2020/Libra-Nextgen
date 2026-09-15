using System.Text.Json;

namespace LibraNextgen.Mobile.Services;

/// <summary>System-bar insets in device-independent pixels.</summary>
public readonly record struct MobileInsets(double Top, double Bottom, double Left, double Right, double Ime);

/// <summary>
/// The one place the native host talks to the console running inside the WebView.
///
/// Two things cross the boundary:
/// <list type="bullet">
/// <item><b>System-bar insets</b> — pushed as CSS custom properties on
/// <c>&lt;html&gt;</c> so the React layout can reserve the status bar, the
/// display cutout, the navigation bar and the keyboard without knowing anything
/// about Android.</item>
/// <item><b>Boot state</b> — the packaged boot screen is driven from here
/// (ready / failed / status) so the loading and failure screens are the same
/// React/HTML surface as the rest of the app.</item>
/// </list>
///
/// Every call is fire-and-forget on the main thread: a WebView that is not ready
/// yet simply misses an update, and <see cref="ReapplyAsync"/> re-syncs on the
/// next document load.
/// </summary>
public static class MobileBridge
{
    /// <summary>User-agent token the console detects; keep in sync with
    /// src/console/src/shell/env.ts (LIBRA_MOBILE_UA).</summary>
    public const string UserAgentToken = "LibraMobile/1.0";

    private static WeakReference<WebView>? _webView;

    /// <summary>Last status-bar appearance the console asked for. Replayed after
    /// every navigation, because a reloaded document cannot restore it itself.</summary>
    private static bool _lightStatusBarIcons = true;

    public static MobileInsets Insets { get; private set; }

    /// <summary>
    /// Set by the page that owns the service lifecycle: the console can ask for a
    /// restart (its offline overlay offers that action) without knowing how the
    /// service is hosted.
    /// </summary>
    public static Func<Task>? RestartRequested { get; set; }

    public static void Attach(WebView? webView) =>
        _webView = webView is null ? null : new WeakReference<WebView>(webView);

    public static void Detach() => _webView = null;

    /// <summary>Called by the platform insets listener whenever the bars move.</summary>
    public static void SetInsets(MobileInsets insets)
    {
        Insets = insets;
        RunAsync(webView => EvaluateAsync(webView, InsetsScript(insets)));
    }

    /// <summary>Re-apply everything after a navigation replaced the document.</summary>
    public static void ReapplyAsync(WebView webView)
    {
        SetStatusBarStyle(_lightStatusBarIcons);
        _ = EvaluateAsync(webView, InsetsScript(Insets));
    }

    /// <summary>The service is up: tell the boot page where the console lives.</summary>
    public static void PushReady(string consoleUrl) =>
        RunAsync(webView => EvaluateAsync(webView, $"window.libraBoot&&window.libraBoot.ready({Json(consoleUrl)});"));

    public static void PushFailure(string message) =>
        RunAsync(webView => EvaluateAsync(webView, $"window.libraBoot&&window.libraBoot.fail({Json(message)});"));

    public static void PushStatus(string message) =>
        RunAsync(webView => EvaluateAsync(webView, $"window.libraBoot&&window.libraBoot.status({Json(message)});"));

    /// <summary>
    /// Appearance the console asked for. The status-bar icons and the native
    /// backdrop behind the WebView both follow it, so a light console never sits
    /// on a dark surface (or the other way round) while the page paints.
    /// </summary>
    public static void SetStatusBarStyle(bool lightIcons)
    {
        _lightStatusBarIcons = lightIcons;
#if ANDROID
        AndroidSystemBars.SetLightIcons(lightIcons);
#endif
        SetBackdropColor(lightIcons);
    }

    /// <summary>Base colours matching the console's own `:root` / `.dark` backgrounds.</summary>
    private const string DarkBackdrop = "#0B0F14";
    private const string LightBackdrop = "#FFFDF9";

    private static void SetBackdropColor(bool lightIcons)
    {
        RunAsync(webView =>
        {
            var color = Color.FromArgb(lightIcons ? DarkBackdrop : LightBackdrop);
            webView.BackgroundColor = color;
            if (webView.Parent is Page page)
                page.BackgroundColor = color;
            return Task.CompletedTask;
        });
    }

    /// <summary>Restart the embedded service, then reload the console onto it.</summary>
    public static async Task RestartAsync()
    {
        if (RestartRequested is null)
            return;

        try
        {
            await RestartRequested();
            RunAsync(webView => EvaluateAsync(webView, "window.location.reload();"));
        }
        catch (Exception ex)
        {
            AppLog.Error("service restart failed", ex);
            PushFailure(ex.Message);
        }
    }

    private static void RunAsync(Func<WebView, Task> action)
    {
        MainThread.BeginInvokeOnMainThread(() =>
        {
            if (_webView?.TryGetTarget(out var webView) != true)
                return;
            _ = action(webView);
        });
    }

    private static async Task EvaluateAsync(WebView webView, string script)
    {
        try
        {
            await webView.EvaluateJavaScriptAsync(script);
        }
        catch (Exception ex)
        {
            // A navigation may have torn the document down mid-call; the next
            // document load re-applies the state anyway.
            AppLog.Warn($"bridge script skipped: {ex.Message}");
        }
    }

    /// <summary>
    /// Publishes the insets both as CSS custom properties (what the layout reads)
    /// and on the bridge object (for the rare JS caller), then notifies listeners.
    /// </summary>
    private static string InsetsScript(MobileInsets i)
    {
        var values = new[]
        {
            ("--libra-inset-top", i.Top),
            ("--libra-inset-bottom", i.Bottom),
            ("--libra-inset-left", i.Left),
            ("--libra-inset-right", i.Right),
            ("--libra-inset-ime", i.Ime),
        };

        var sets = string.Join(
            string.Empty,
            values.Select(v => $"r.setProperty('{v.Item1}','{v.Item2.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture)}px');"));

        var json = JsonSerializer.Serialize(new
        {
            top = i.Top,
            bottom = i.Bottom,
            left = i.Left,
            right = i.Right,
            ime = i.Ime,
        });

        return $"(function(){{var r=document.documentElement.style;{sets}"
               + $"window.libraMobile=window.libraMobile||{{}};window.libraMobile.insets={json};"
               + "window.libraMobile.setStatusBarStyle=function(s){try{window.libraNative&&window.libraNative.setStatusBarStyle(s);}catch(e){}};"
               + "window.libraMobile.restartService=function(){try{window.libraNative&&window.libraNative.restartService();}catch(e){}};"
               + "window.libraMobile.toast=function(m){try{window.libraNative&&window.libraNative.toast(String(m));}catch(e){}};"
               + "window.libraMobile.notify=function(t,b){try{window.libraNative&&window.libraNative.notify(String(t),String(b));}catch(e){}};"
               + "window.dispatchEvent(new CustomEvent('libra:insets'));})();";
    }

    private static string Json(string value) => JsonSerializer.Serialize(value);
}
