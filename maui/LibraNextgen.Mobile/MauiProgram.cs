using LibraNextgen.Mobile.Services;
using LibraNextgen.Service;
using Microsoft.Extensions.Logging;

namespace LibraNextgen.Mobile;

public static class MauiProgram
{
	public static MauiApp CreateMauiApp()
	{
		// The embedded service logs to its own providers; route them into the app
		// log so a failure can be diagnosed from the device (the app has no
		// console and no settings surface on purpose).
		LibraServiceHost.AdditionalLoggingSink = logging => logging.AddProvider(new AppLogLoggerProvider());

		var builder = MauiApp.CreateBuilder();
		builder
			.UseMauiApp<App>()
			.ConfigureFonts(fonts =>
			{
				fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
				fonts.AddFont("OpenSans-Semibold.ttf", "OpenSansSemibold");
			});

#if ANDROID
		ConfigureAndroidWebView();
#endif

#if DEBUG
		builder.Logging.AddDebug();
#endif

		return builder.Build();
	}

#if ANDROID
	/// <summary>
	/// The console is a normal web app: it needs JavaScript, web storage (JWT and
	/// UI state live in localStorage) and — because the embedded service speaks
	/// plain HTTP on loopback — the ability to talk to it without mixed-content
	/// blocking. Android's WebView has all of these off or restricted by default.
	///
	/// The user agent carries the token the console uses to recognise the app, so
	/// it is set here rather than left to chance.
	/// </summary>
	private static void ConfigureAndroidWebView()
	{
		Microsoft.Maui.Handlers.WebViewHandler.Mapper.AppendToMapping(
			"LibraConsoleWebView",
			(handler, view) =>
			{
				var platformView = handler.PlatformView;
				var settings = platformView.Settings;
				settings.JavaScriptEnabled = true;
				settings.DomStorageEnabled = true;
				settings.DatabaseEnabled = true;
				settings.AllowFileAccess = false;
				settings.SetSupportMultipleWindows(false);
				settings.MixedContentMode = Android.Webkit.MixedContentHandling.AlwaysAllow;

				var baseAgent = settings.UserAgentString ?? string.Empty;
				if (!baseAgent.Contains(MobileBridge.UserAgentToken, StringComparison.Ordinal))
					settings.UserAgentString = $"{baseAgent} {MobileBridge.UserAgentToken}";

				// Only the app's own two entry points ever need the native bridge
				// (status-bar style, service restart); the interface is scoped to
				// them so page scripts on any other origin cannot reach it.
				platformView.AddJavascriptInterface(new NativeBridge(), NativeBridge.InterfaceName);
				platformView.SetBackgroundColor(Android.Graphics.Color.ParseColor("#0B0F14"));
			});
	}
#endif
}
