using Android.App;
using Android.Content;
using Android.OS;
using Android.Widget;
using AndroidX.Core.App;
using AndroidX.Core.Content;
using LibraNextgen.Mobile.Services;

namespace LibraNextgen.Mobile;

/// <summary>
/// System surfaces the console can reach: a transient toast and a real system
/// notification. Both are optional niceties — the console keeps working when the
/// host does not provide them (plain browser, desktop shell) — so every entry
/// point is defensive.
/// </summary>
internal static class AndroidNotifications
{
    private const string ChannelId = "libra.default";
    private const string ChannelName = "Libra 通知";
    private const int NotificationId = 1001;

    /// <summary>API 33+ requires the user's consent before anything is posted.</summary>
    public const string PostNotifications = "android.permission.POST_NOTIFICATIONS";

    public static void ShowToast(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
            return;

        MainThread.BeginInvokeOnMainThread(() =>
        {
            var context = AndroidSystemBars.Current;
            if (context is null)
                return;
            Toast.MakeText(context, message, ToastLength.Short)?.Show();
        });
    }

    /// <summary>Post a notification, creating the channel and asking for consent
    /// on first use so the caller never has to think about Android versions.</summary>
    public static void ShowNotification(string title, string body)
    {
        MainThread.BeginInvokeOnMainThread(() =>
        {
            var activity = AndroidSystemBars.Current;
            if (activity is null)
                return;

            var manager = (NotificationManager?)activity.GetSystemService(Context.NotificationService);
            if (manager is null)
                return;

            EnsureChannel(manager);

            if (Build.VERSION.SdkInt >= BuildVersionCodes.Tiramisu
                && ContextCompat.CheckSelfPermission(activity, PostNotifications) != Android.Content.PM.Permission.Granted)
            {
                // Ask once; the notification for this call is skipped, the next one
                // after the user accepts goes through.
                ActivityCompat.RequestPermissions(activity, [PostNotifications], 0);
                AppLog.Info("notification permission requested");
                return;
            }

            var intent = new Intent(activity, typeof(MainActivity));
            intent.SetFlags(ActivityFlags.SingleTop | ActivityFlags.ClearTop);
            var pending = PendingIntent.GetActivity(
                activity, 0, intent, PendingIntentFlags.Immutable | PendingIntentFlags.UpdateCurrent);

            var notification = new NotificationCompat.Builder(activity, ChannelId)
                .SetContentTitle(title)
                .SetContentText(body)
                .SetStyle(new NotificationCompat.BigTextStyle().BigText(body))
                .SetSmallIcon(activity.ApplicationInfo?.Icon ?? Android.Resource.Drawable.IcDialogInfo)
                .SetAutoCancel(true)
                .SetContentIntent(pending)
                .Build();

            manager.Notify(NotificationId, notification);
        });
    }

    private static void EnsureChannel(NotificationManager manager)
    {
        if (Build.VERSION.SdkInt < BuildVersionCodes.O)
            return;

        if (manager.GetNotificationChannel(ChannelId) is not null)
            return;

        var channel = new NotificationChannel(ChannelId, ChannelName, NotificationImportance.Default)
        {
            Description = "任务与设备事件提醒",
        };
        manager.CreateNotificationChannel(channel);
    }
}
