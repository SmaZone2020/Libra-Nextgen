using Android.App;
using Android.Content.PM;
using Android.OS;
using AndroidX.Activity;
using LibraNextgen.Mobile.Services;

namespace LibraNextgen.Mobile;

[Activity(Theme = "@style/Libra.SplashTheme", MainLauncher = true, LaunchMode = LaunchMode.SingleTop, ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
public class MainActivity : MauiAppCompatActivity
{
    protected override void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);

        // Content is drawn edge to edge; the console reserves the system-bar
        // space from the insets this starts reporting.
        AndroidSystemBars.EnableEdgeToEdge(this);

        // Back routing goes through the dispatcher on every supported API level
        // (the deprecated OnBackPressed override is ignored from API 33 on).
        OnBackPressedDispatcher.AddCallback(this, new BackCallback(this));
    }

    /// <summary>
    /// Back returns to the console's previous view; only at the console's entry
    /// point does the press leave the app.
    /// </summary>
    private sealed class BackCallback(MainActivity activity) : OnBackPressedCallback(true)
    {
        private readonly MainActivity _activity = activity;

        public override void HandleOnBackPressed()
        {
            if (WebNavigation.TryGoBack())
                return;

            // Nothing left in the console: step aside for this press so the
            // system can close the app, then re-arm for the next one.
            Enabled = false;
            _activity.OnBackPressedDispatcher.OnBackPressed();
            Enabled = true;
        }
    }
}
