using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using LibraNextgen.Agent.Communication;

namespace LibraNextgen.Agent.Modules.Execution;

public sealed class ScreenCapture : IDisposable
{
    private readonly WsCommunicator _ws;
    private readonly string _agentId;

    private int _fps = 5;
    private string _quality = "720p";
    private int _screenIndex = 0;
    private const int BlockSize = 64;
    private const int JpegQuality = 70;

    private CancellationTokenSource? _cts;
    private Task? _captureTask;
    private byte[]? _previousFrame;
    private int _frameWidth;
    private int _frameHeight;

    public ScreenCapture(WsCommunicator ws, string agentId)
    {
        _ws = ws;
        _agentId = agentId;
    }

    /// <summary>List available screens via PowerShell Get-WmiObject Win32_VideoController.</summary>
    public static string ListScreens()
    {
        if (!OperatingSystem.IsWindows())
            return """{"screens":[],"error":"Not supported on this platform"}""";

        try
        {
            var script = @"
Get-WmiObject Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution -ne $null } | ForEach-Object {
    [PSCustomObject]@{
        Caption = $_.Caption
        CurrentHorizontalResolution = $_.CurrentHorizontalResolution
        CurrentVerticalResolution = $_.CurrentVerticalResolution
    }
} | ConvertTo-Json -Compress
";
            using var proc = new System.Diagnostics.Process
            {
                StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "powershell",
                    Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"{script}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = false,
                }
            };
            proc.Start();
            var json = proc.StandardOutput.ReadToEnd().Trim();
            proc.WaitForExit(3000);

            if (string.IsNullOrEmpty(json) || !json.Contains('['))
                return """{"screens":[]}""";

            // Parse the PowerShell array and reformat with index
            var screens = new List<string>();
            int idx = 0;
            // Simple JSON array parser for the PowerShell output
            var objs = ParseJsonArray(json);
            foreach (var obj in objs)
            {
                if (obj.TryGetValue("CurrentHorizontalResolution", out var wVal) &&
                    obj.TryGetValue("CurrentVerticalResolution", out var hVal) &&
                    int.TryParse(wVal?.ToString(), out var w) && w > 0 &&
                    int.TryParse(hVal?.ToString(), out var h) && h > 0)
                {
                    var caption = obj.TryGetValue("Caption", out var c) ? c?.ToString() ?? "" : "";
                    screens.Add($$"""{"index":{{idx}},"width":{{w}},"height":{{h}},"caption":"{{Esc(caption!)}}"}""");
                    idx++;
                }
            }
            return $$"""{"screens":[{{string.Join(",", screens)}}]}""";
        }
        catch
        {
            return """{"screens":[]}""";
        }
    }

    private static List<Dictionary<string, object?>> ParseJsonArray(string json)
    {
        var result = new List<Dictionary<string, object?>>();
        var start = json.IndexOf('[');
        var end = json.LastIndexOf(']');
        if (start < 0 || end < 0) return result;

        var inner = json.Substring(start + 1, end - start - 1);
        var depth = 0;
        var objStart = -1;
        for (int i = 0; i < inner.Length; i++)
        {
            if (inner[i] == '{') { if (depth == 0) objStart = i; depth++; }
            else if (inner[i] == '}')
            {
                depth--;
                if (depth == 0 && objStart >= 0)
                {
                    var objStr = inner.Substring(objStart, i - objStart + 1);
                    var dict = new Dictionary<string, object?>();
                    // Simple key-value parser
                    var inKey = true; var inStr = false; var key = ""; var val = "";
                    for (int j = 1; j < objStr.Length - 1; j++)
                    {
                        var c = objStr[j];
                        if (c == '"' && (j == 0 || objStr[j - 1] != '\\')) { inStr = !inStr; continue; }
                        if (!inStr && c == ':') { inKey = false; continue; }
                        if (!inStr && c == ',')
                        {
                            dict[key.Trim('"', ' ')] = val.Trim('"', ' ');
                            key = ""; val = ""; inKey = true;
                            continue;
                        }
                        if (inKey) key += c; else val += c;
                    }
                    if (!string.IsNullOrEmpty(key))
                        dict[key.Trim('"', ' ')] = val.Trim('"', ' ');
                    result.Add(dict);
                }
            }
        }
        return result;
    }

    public void Start(int fps, string quality, int screenIndex = 0)
    {
        Stop();
        _fps = Math.Clamp(fps, 1, 15);
        _quality = quality;
        _screenIndex = screenIndex;
        _previousFrame = null;
        _cts = new CancellationTokenSource();
        _captureTask = Task.Run(() => CaptureLoopAsync(_cts.Token));
    }

    public void Stop()
    {
        _cts?.Cancel();
        try { _captureTask?.Wait(2000); } catch { }
        _cts?.Dispose();
        _cts = null;
        _captureTask = null;
        _previousFrame = null;
    }

    public void SetFps(int fps) => _fps = Math.Clamp(fps, 1, 15);

    public void SetScreenIndex(int index)
    {
        _screenIndex = index;
        _previousFrame = null;
    }

    public void SetQuality(string quality)
    {
        _quality = quality;
        _previousFrame = null;
    }

    public void Dispose() => Stop();

    private async Task CaptureLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                await CaptureAndSendAsync(ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                try { await _ws.SendResultRawAsync("screen.error", _agentId, $$"""{"error":"{{Esc(ex.Message)}}"}"""); }
                catch { }
                await Task.Delay(1000, ct);
                continue;
            }

            sw.Stop();
            var interval = 1000 / _fps;
            var delay = interval - (int)sw.ElapsedMilliseconds;
            if (delay > 0)
            {
                try { await Task.Delay(delay, ct); }
                catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task CaptureAndSendAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows())
        {
            await _ws.SendResultRawAsync("screen.error", _agentId,
                """{"error":"Screen capture only supported on Windows"}""");
            _cts?.Cancel();
            return;
        }

        var monitors = GetMonitorRects();
        if (monitors.Count == 0) return;

        int idx = Math.Min(_screenIndex, monitors.Count - 1);
        var m = monitors[idx];
        int capX = m.Left;
        int capY = m.Top;
        int screenW = m.Right - m.Left;
        int screenH = m.Bottom - m.Top;

        if (screenW == 0 || screenH == 0) return;

        var (targetW, targetH) = GetTargetDimensions(screenW, screenH, _quality);

        using var bmp = CaptureScreenRegion(capX, capY, screenW, screenH, targetW, targetH);
        var pixels = GetPixelBytes(bmp);

        if (_previousFrame == null || _frameWidth != targetW || _frameHeight != targetH)
        {
            _frameWidth = targetW;
            _frameHeight = targetH;
            var jpeg = BitmapToJpeg(bmp);
            _previousFrame = pixels;
            await _ws.SendResultRawAsync("screen.frame", _agentId,
                $$"""{"width":{{targetW}},"height":{{targetH}},"jpeg":"{{Convert.ToBase64String(jpeg)}}"}""");
        }
        else
        {
            var blocks = ComputeChangedBlocks(pixels, _previousFrame, targetW, targetH);
            _previousFrame = pixels;

            if (blocks.Count == 0) return;

            int totalBlocks = ((targetW + BlockSize - 1) / BlockSize) * ((targetH + BlockSize - 1) / BlockSize);
            if (blocks.Count > totalBlocks * 7 / 10)
            {
                var jpeg = BitmapToJpeg(bmp);
                await _ws.SendResultRawAsync("screen.frame", _agentId,
                    $$"""{"width":{{targetW}},"height":{{targetH}},"jpeg":"{{Convert.ToBase64String(jpeg)}}"}""");
            }
            else
            {
                var encoded = EncodeBlocks(bmp, blocks);
                await _ws.SendResultRawAsync("screen.diff", _agentId, $$"""{"blocks":[{{string.Join(",", encoded)}}]}""");
            }
        }
    }

    private static Bitmap CaptureScreenRegion(int capX, int capY, int screenW, int screenH, int targetW, int targetH)
    {
        using var full = new Bitmap(screenW, screenH, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(full))
        {
            g.CopyFromScreen(capX, capY, 0, 0, new Size(screenW, screenH), CopyPixelOperation.SourceCopy);
        }

        if (targetW == screenW && targetH == screenH)
            return (Bitmap)full.Clone();

        var scaled = new Bitmap(targetW, targetH, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(scaled))
        {
            g.InterpolationMode = InterpolationMode.Bilinear;
            g.DrawImage(full, 0, 0, targetW, targetH);
        }
        return scaled;
    }

    private static byte[] GetPixelBytes(Bitmap bmp)
    {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        try
        {
            int stride = data.Stride;
            int size = stride * bmp.Height;
            byte[] pixels = new byte[size];
            Marshal.Copy(data.Scan0, pixels, 0, size);
            return pixels;
        }
        finally { bmp.UnlockBits(data); }
    }

    private static byte[] BitmapToJpeg(Bitmap bmp)
    {
        using var ms = new MemoryStream();
        var encoder = GetJpegEncoder();
        var encParams = new EncoderParameters(1);
        encParams.Param[0] = new EncoderParameter(Encoder.Quality, (long)JpegQuality);
        bmp.Save(ms, encoder, encParams);
        return ms.ToArray();
    }

    private static byte[] BlockToJpeg(Bitmap bmp, int x, int y, int w, int h)
    {
        using var block = bmp.Clone(new Rectangle(x, y, w, h), PixelFormat.Format24bppRgb);
        using var ms = new MemoryStream();
        var encoder = GetJpegEncoder();
        var encParams = new EncoderParameters(1);
        encParams.Param[0] = new EncoderParameter(Encoder.Quality, (long)JpegQuality);
        block.Save(ms, encoder, encParams);
        return ms.ToArray();
    }

    private static ImageCodecInfo GetJpegEncoder()
    {
        foreach (var codec in ImageCodecInfo.GetImageEncoders())
        {
            if (codec.MimeType == "image/jpeg") return codec;
        }
        throw new InvalidOperationException("JPEG encoder not found");
    }

    private static (int w, int h) GetTargetDimensions(int srcW, int srcH, string quality)
    {
        int maxH = quality switch
        {
            "1080p" => 1080,
            "720p" => 720,
            "540p" => 540,
            "360p" => 360,
            "240p" => 240,
            _ => srcH
        };
        if (srcH <= maxH) return (srcW, srcH);
        double scale = (double)maxH / srcH;
        return ((int)(srcW * scale), maxH);
    }

    private static List<BlockInfo> ComputeChangedBlocks(byte[] current, byte[] previous, int width, int height)
    {
        var blocks = new List<BlockInfo>();
        int stride = ((width * 3 + 3) / 4) * 4;
        int blocksX = (width + BlockSize - 1) / BlockSize;
        int blocksY = (height + BlockSize - 1) / BlockSize;

        for (int by = 0; by < blocksY; by++)
        {
            for (int bx = 0; bx < blocksX; bx++)
            {
                int x = bx * BlockSize;
                int y = by * BlockSize;
                int w = Math.Min(BlockSize, width - x);
                int h = Math.Min(BlockSize, height - y);

                if (!BlockEquals(current, previous, x, y, w, h, stride))
                    blocks.Add(new BlockInfo(x, y, w, h));
            }
        }
        return blocks;
    }

    private static bool BlockEquals(byte[] a, byte[] b, int x, int y, int w, int h, int stride)
    {
        for (int row = y; row < y + h; row++)
        {
            int offset = row * stride + x * 3;
            int len = w * 3;
            if (!a.AsSpan(offset, len).SequenceEqual(b.AsSpan(offset, len)))
                return false;
        }
        return true;
    }

    private static List<string> EncodeBlocks(Bitmap bmp, List<BlockInfo> blocks)
    {
        var result = new List<string>(blocks.Count);
        foreach (var b in blocks)
        {
            var jpeg = BlockToJpeg(bmp, b.X, b.Y, b.W, b.H);
            result.Add($$"""{"x":{{b.X}},"y":{{b.Y}},"w":{{b.W}},"h":{{b.H}},"data":"{{Convert.ToBase64String(jpeg)}}"}""");
        }
        return result;
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    // ── Multi-monitor enumeration ──────────────────────────────────────

    private static List<MonitorRect> GetMonitorRects()
    {
        var rects = new List<MonitorRect>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr hMonitor, IntPtr hdc, ref RECT lprc, IntPtr lParam) =>
        {
            var mi = new MONITORINFO();
            mi.cbSize = Marshal.SizeOf<MONITORINFO>();
            if (GetMonitorInfoW(hMonitor, ref mi))
            {
                rects.Add(new MonitorRect(mi.rcMonitor.Left, mi.rcMonitor.Top,
                    mi.rcMonitor.Right, mi.rcMonitor.Bottom));
            }
            return true;
        }, IntPtr.Zero);
        return rects;
    }

    private record struct BlockInfo(int X, int Y, int W, int H);
    private record struct MonitorRect(int Left, int Top, int Right, int Bottom);

    // ── P/Invoke ──────────────────────────────────────────────────────

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip,
        MonitorEnumDelegate lpfnEnum, IntPtr dwData);

    private delegate bool MonitorEnumDelegate(IntPtr hMonitor, IntPtr hdc,
        ref RECT lprcMonitor, IntPtr dwData);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfoW(IntPtr hMonitor, ref MONITORINFO lpmi);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);
}
