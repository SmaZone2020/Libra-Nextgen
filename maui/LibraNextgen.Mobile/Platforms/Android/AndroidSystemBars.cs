using Android.OS;
using Android.Views;
using AndroidX.Core.View;
using LibraNextgen.Mobile.Services;

namespace LibraNextgen.Mobile;

/// <summary>
/// Edge-to-edge plumbing for the system bars.
///
/// The app targets API 36, so on Android 15+ edge-to-edge is enforced whether the
/// app wants it or not; opting in explicitly keeps API 34 and 35+ behaving the
/// same instead of one leaving black bars and the other drawing under them. Once
/// edge-to-edge, the bars are transparent and the WebView content flows behind
/// them, so the app must publish the insets (see <see cref="MobileBridge"/>) and
/// let the console reserve the space.
/// </summary>
internal static class AndroidSystemBars
{
    // Held weakly: the bars controller needs the live activity, and the static
    // bridge must never keep a destroyed one alive across a configuration change.
    private static WeakReference<Android.App.Activity>? _activity;

    /// <summary>Apply transparent bars and start reporting insets.</summary>
    public static void EnableEdgeToEdge(Android.App.Activity activity)
    {
        var window = activity.Window;
        if (window is null)
            return;

        _activity = new WeakReference<Android.App.Activity>(activity);

        WindowCompat.SetDecorFitsSystemWindows(window, false);
        window.SetStatusBarColor(Android.Graphics.Color.Transparent);
        window.SetNavigationBarColor(Android.Graphics.Color.Transparent);

        // Android 10+ draws a scrim behind the gesture bar by default, which
        // would paint a grey band over the console.
        if (Build.VERSION.SdkInt >= BuildVersionCodes.Q)
            window.NavigationBarContrastEnforced = false;

        var root = window.DecorView;
        ViewCompat.SetOnApplyWindowInsetsListener(root, new InsetsListener(activity));
        ViewCompat.RequestApplyInsets(root);
    }

    /// <summary>Switch the bar icons between light and dark for contrast.</summary>
    public static void SetLightIcons(bool lightIcons)
    {
        // Reached from the WebView's JavaBridge thread, where every Window/view
        // call is rejected with CalledFromWrongThreadException and kills the
        // process. The console flips this on every theme change, so it must hop
        // to the main thread.
        MainThread.BeginInvokeOnMainThread(() =>
        {
            if (_activity?.TryGetTarget(out var activity) != true)
                return;

            var window = activity.Window;
            if (window is null)
                return;

            var controller = WindowCompat.GetInsetsController(window, window.DecorView);
            if (controller is null)
                return;
            controller.AppearanceLightStatusBars = lightIcons;
            controller.AppearanceLightNavigationBars = lightIcons;
        });
    }

    /// <summary>The live activity, for callers that need to touch the window.</summary>
    public static Android.App.Activity? Current =>
        _activity?.TryGetTarget(out var activity) == true ? activity : null;

    /// <summary>
    /// Reports system bars, display cutout and the keyboard separately: the
    /// keyboard inset is what keeps the AI composer and the terminal above the
    /// on-screen keyboard, while the bars reserve permanent space.
    /// </summary>
    private sealed class InsetsListener(Android.App.Activity activity) : Java.Lang.Object, IOnApplyWindowInsetsListener
    {
        private readonly Android.App.Activity _activity = activity;

        public WindowInsetsCompat? OnApplyWindowInsets(Android.Views.View? view, WindowInsetsCompat? insets)
        {
            if (insets is not null)
            {
                var bars = insets.GetInsets(
                    WindowInsetsCompat.Type.SystemBars() | WindowInsetsCompat.Type.DisplayCutout())!;
                var ime = insets.GetInsets(WindowInsetsCompat.Type.Ime())!;

                var density = _activity.Resources?.DisplayMetrics?.Density ?? 1f;
                MobileBridge.SetInsets(new MobileInsets(
                    bars.Top / density,
                    bars.Bottom / density,
                    bars.Left / density,
                    bars.Right / density,
                    ime.Bottom / density));
            }

            return insets;
        }
    }
}
