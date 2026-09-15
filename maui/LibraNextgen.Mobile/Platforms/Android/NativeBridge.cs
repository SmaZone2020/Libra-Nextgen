using Android.Webkit;
using LibraNextgen.Mobile.Services;

namespace LibraNextgen.Mobile;

/// <summary>
/// The JS → native half of the bridge, exposed to the console as
/// <c>window.libraNative</c>.
///
/// Only the two calls the console actually needs cross here. Everything else
/// travels native → JS through <see cref="MobileBridge"/>, which needs no
/// interface at all.
///
/// Every method here runs on the WebView's JavaBridge thread, never on the UI
/// thread, so anything touching Android UI must hand off to the main thread.
/// </summary>
public sealed class NativeBridge : Java.Lang.Object
{
    public const string InterfaceName = "libraNative";

    /// <summary>Matches the status-bar icons to the console theme.</summary>
    [JavascriptInterface]
    [Java.Interop.Export("setStatusBarStyle")]
    public void SetStatusBarStyle(string style) =>
        MobileBridge.SetStatusBarStyle(style == "light");

    /// <summary>Restarts the embedded service (console offline overlay action).</summary>
    [JavascriptInterface]
    [Java.Interop.Export("restartService")]
    public void RestartService() =>
        MainThread.BeginInvokeOnMainThread(() => _ = MobileBridge.RestartAsync());

    /// <summary>In-app history depth, so Back can tell "go back" from "leave".</summary>
    [JavascriptInterface]
    [Java.Interop.Export("setNavDepth")]
    public void SetNavDepth(int depth) => WebNavigation.SetNavDepth(depth);

    /// <summary>Transient system toast.</summary>
    [JavascriptInterface]
    [Java.Interop.Export("toast")]
    public void Toast(string message) => AndroidNotifications.ShowToast(message);

    /// <summary>System notification.</summary>
    [JavascriptInterface]
    [Java.Interop.Export("notify")]
    public void Notify(string title, string body) => AndroidNotifications.ShowNotification(title, body);
}
