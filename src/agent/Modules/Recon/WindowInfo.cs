using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace LibraNextgen.Agent.Modules.Recon;

public static class WindowInfo
{
    public static string Collect()
    {
        if (!OperatingSystem.IsWindows())
        {
            return """{"windows":[],"supported":false}""";
        }

        var items = new List<string>();
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

            items.Add($$"""{"hwnd":{{hWnd.ToInt64()}},"title":"{{Esc(title)}}","processId":{{(int)processId}},"processName":"{{Esc(processName)}}","className":"{{Esc(sb.ToString())}}"}""");

            return true;
        }, IntPtr.Zero);

        return $$"""{"windows":[{{string.Join(",", items)}}],"supported":true}""";
    }

    public static string CloseWindow(long hwnd)
    {
        if (!OperatingSystem.IsWindows())
            return """{"error":"Not supported on this platform"}""";
        var h = new IntPtr(hwnd);
        PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        return $$"""{"hwnd":{{hwnd}},"status":"closed"}""";
    }

    public static string MinimizeWindow(long hwnd)
    {
        if (!OperatingSystem.IsWindows())
            return """{"error":"Not supported on this platform"}""";
        ShowWindow(new IntPtr(hwnd), SW_MINIMIZE);
        return $$"""{"hwnd":{{hwnd}},"status":"minimized"}""";
    }

    public static string MaximizeWindow(long hwnd)
    {
        if (!OperatingSystem.IsWindows())
            return """{"error":"Not supported on this platform"}""";
        ShowWindow(new IntPtr(hwnd), SW_MAXIMIZE);
        return $$"""{"hwnd":{{hwnd}},"status":"maximized"}""";
    }

    public static string SetTopmost(long hwnd)
    {
        if (!OperatingSystem.IsWindows())
            return """{"error":"Not supported on this platform"}""";
        SetWindowPos(new IntPtr(hwnd), HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        return $$"""{"hwnd":{{hwnd}},"status":"topmost"}""";
    }

    public static string SetBottom(long hwnd)
    {
        if (!OperatingSystem.IsWindows())
            return """{"error":"Not supported on this platform"}""";
        SetWindowPos(new IntPtr(hwnd), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        return $$"""{"hwnd":{{hwnd}},"status":"bottom"}""";
    }

    public static string SetTitle(long hwnd, string title)
    {
        if (!OperatingSystem.IsWindows())
            return """{"error":"Not supported on this platform"}""";
        SetWindowText(new IntPtr(hwnd), title);
        return $$"""{"hwnd":{{hwnd}},"title":"{{Esc(title)}}","status":"title_changed"}""";
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private const uint WM_CLOSE = 0x0010;
    private const int SW_MINIMIZE = 6;
    private const int SW_MAXIMIZE = 3;
    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private static readonly IntPtr HWND_BOTTOM = new(1);
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOSIZE = 0x0001;

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool SetWindowText(IntPtr hWnd, string lpString);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
