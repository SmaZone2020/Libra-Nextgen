using LibraNextgen.Mobile.Services;

namespace LibraNextgen.Mobile;

public partial class App : Application
{
	public App()
	{
		InitializeComponent();

		// Deliberately no UserAppTheme: forcing one pins the whole app — and the
		// WebView's prefers-color-scheme with it — to that appearance, which made
		// the console's "follow the system" theme setting do nothing. Unspecified,
		// the app follows the device and the console tracks it live.

		// The console's offline overlay asks for a service restart through the
		// bridge; the page owns the actual lifecycle.
		MobileBridge.RestartRequested = () => LocalServiceHost.Instance.StartAsync();

		AppLog.Info($"app start {AppInfo.Current.VersionString} ({AppInfo.Current.BuildString})");
	}

	protected override Window CreateWindow(IActivationState? activationState)
	{
		// Single full-bleed WebView page: no Shell, no NavigationPage, no toolbar.
		var window = new Window(new MainPage());

		// The embedded service lives in this process: stop it when the app is
		// torn down (the mobile analogue of the desktop shell reaping its sidecar).
		window.Destroying += async (_, _) => await LocalServiceHost.Instance.StopAsync();

		return window;
	}
}
