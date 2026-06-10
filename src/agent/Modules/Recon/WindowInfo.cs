using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace LibraNextgen.Agent.Modules.Recon;

public static class WindowInfo
{
    public static string Collect()
    {
        if (!OperatingSystem.IsWindows())
        {
            return JsonSerializer.Serialize(new { windows = Array.Empty<object>(), supported = false });
        }

        var windows = new List<object>();
        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd)) return true;

            var sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            var title = sb.ToString();
            if (string.IsNullOrWhiteSpace(title)) return true;

            GetWindowThreadProcessId(hWnd, out uint processId);

            string processName = "";
            try
            {
                var proc = Process.GetProcessById((int)processId);
                processName = proc.ProcessName;
            }
            catch { }

            sb.Clear();
            GetClassName(hWnd, sb, 256);

            windows.Add(new
            {
                hwnd = hWnd.ToInt64(),
                title,
                processId = (int)processId,
                processName,
                className = sb.ToString()
            });

            return true;
        }, IntPtr.Zero);

        return JsonSerializer.Serialize(new { windows, supported = true });
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
