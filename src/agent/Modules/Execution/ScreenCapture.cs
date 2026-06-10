using System.Runtime.InteropServices;
using LibraNextgen.Agent.Communication;

namespace LibraNextgen.Agent.Modules.Execution;

public sealed class ScreenCapture : IDisposable
{
    private readonly WsCommunicator _ws;
    private readonly string _agentId;

    private int _fps = 5;
    private string _quality = "720p";
    private const int BlockSize = 64;

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

    public void Start(int fps, string quality)
    {
        Stop();
        _fps = Math.Clamp(fps, 1, 15);
        _quality = quality;
        _previousFrame = null;
        _cts = new CancellationTokenSource();
        InitGdiPlus();
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
        ShutdownGdiPlus();
    }

    public void SetFps(int fps) => _fps = Math.Clamp(fps, 1, 15);

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
            catch (Exception ex)
            {
                await _ws.SendResultAsync("screen.error", _agentId, new { error = ex.Message });
                await Task.Delay(1000, ct);
                continue;
            }

            sw.Stop();
            var interval = 1000 / _fps;
            var delay = interval - (int)sw.ElapsedMilliseconds;
            if (delay > 0) await Task.Delay(delay, ct);
        }
    }

    private async Task CaptureAndSendAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows())
        {
            await _ws.SendResultAsync("screen.error", _agentId, new { error = "Screen capture only supported on Windows" });
            _cts?.Cancel();
            return;
        }

        var (screenW, screenH) = GetScreenSize();
        if (screenW == 0 || screenH == 0) return;

        var (targetW, targetH) = GetTargetDimensions(screenW, screenH, _quality);
        var pixels = CaptureScreenPixels(screenW, screenH, targetW, targetH);
        if (pixels == null) return;

        if (_previousFrame == null || _frameWidth != targetW || _frameHeight != targetH)
        {
            _frameWidth = targetW;
            _frameHeight = targetH;
            var jpeg = EncodeFullJpeg(pixels, targetW, targetH);
            _previousFrame = pixels;
            await _ws.SendResultAsync("screen.frame", _agentId, new
            {
                width = targetW,
                height = targetH,
                jpeg = Convert.ToBase64String(jpeg)
            });
        }
        else
        {
            var blocks = ComputeChangedBlocks(pixels, _previousFrame, targetW, targetH);
            _previousFrame = pixels;

            if (blocks.Count == 0) return;

            int totalBlocks = ((targetW + BlockSize - 1) / BlockSize) * ((targetH + BlockSize - 1) / BlockSize);
            if (blocks.Count > totalBlocks * 0.7)
            {
                var jpeg = EncodeFullJpeg(pixels, targetW, targetH);
                await _ws.SendResultAsync("screen.frame", _agentId, new
                {
                    width = targetW,
                    height = targetH,
                    jpeg = Convert.ToBase64String(jpeg)
                });
            }
            else
            {
                var encoded = EncodeBlocks(pixels, targetW, blocks);
                await _ws.SendResultAsync("screen.diff", _agentId, new { blocks = encoded });
            }
        }
    }

    private static (int w, int h) GetScreenSize()
    {
        int w = GetSystemMetrics(SM_CXSCREEN);
        int h = GetSystemMetrics(SM_CYSCREEN);
        return (w, h);
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

    private static byte[]? CaptureScreenPixels(int screenW, int screenH, int targetW, int targetH)
    {
        IntPtr hdcScreen = GetDC(IntPtr.Zero);
        IntPtr hdcMem = CreateCompatibleDC(hdcScreen);
        IntPtr hBitmap = CreateCompatibleBitmap(hdcScreen, targetW, targetH);
        IntPtr hOld = SelectObject(hdcMem, hBitmap);

        if (targetW == screenW && targetH == screenH)
        {
            BitBlt(hdcMem, 0, 0, targetW, targetH, hdcScreen, 0, 0, SRCCOPY);
        }
        else
        {
            SetStretchBltMode(hdcMem, HALFTONE);
            StretchBlt(hdcMem, 0, 0, targetW, targetH, hdcScreen, 0, 0, screenW, screenH, SRCCOPY);
        }

        var bmi = new BITMAPINFO();
        bmi.bmiHeader.biSize = 40;
        bmi.bmiHeader.biWidth = targetW;
        bmi.bmiHeader.biHeight = -targetH;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 24;
        bmi.bmiHeader.biCompression = 0;

        int stride = ((targetW * 3 + 3) / 4) * 4;
        byte[] pixels = new byte[stride * targetH];
        GetDIBits(hdcMem, hBitmap, 0, (uint)targetH, pixels, ref bmi, 0);

        SelectObject(hdcMem, hOld);
        DeleteObject(hBitmap);
        DeleteDC(hdcMem);
        ReleaseDC(IntPtr.Zero, hdcScreen);

        return pixels;
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
                {
                    blocks.Add(new BlockInfo(x, y, w, h));
                }
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

    private static byte[] EncodeFullJpeg(byte[] bgrPixels, int width, int height)
    {
        int stride = ((width * 3 + 3) / 4) * 4;
        return EncodeJpegGdiPlus(bgrPixels, width, height, stride, 0, 0, width, height);
    }

    private static List<object> EncodeBlocks(byte[] bgrPixels, int frameWidth, List<BlockInfo> blocks)
    {
        int stride = ((frameWidth * 3 + 3) / 4) * 4;
        var result = new List<object>(blocks.Count);
        foreach (var b in blocks)
        {
            var jpeg = EncodeJpegGdiPlus(bgrPixels, frameWidth, 0, stride, b.X, b.Y, b.W, b.H);
            result.Add(new { x = b.X, y = b.Y, w = b.W, h = b.H, data = Convert.ToBase64String(jpeg) });
        }
        return result;
    }

    private static byte[] EncodeJpegGdiPlus(byte[] bgrPixels, int frameWidth, int frameHeight, int stride, int x, int y, int w, int h)
    {
        IntPtr gpBitmap = IntPtr.Zero;
        int blockStride = ((w * 3 + 3) / 4) * 4;
        byte[] blockPixels = new byte[blockStride * h];

        for (int row = 0; row < h; row++)
        {
            int srcOffset = (y + row) * stride + x * 3;
            int dstOffset = row * blockStride;
            Buffer.BlockCopy(bgrPixels, srcOffset, blockPixels, dstOffset, w * 3);
        }

        var handle = GCHandle.Alloc(blockPixels, GCHandleType.Pinned);
        try
        {
            int status = GdipCreateBitmapFromScan0(w, h, blockStride, PixelFormat24bppRGB, handle.AddrOfPinnedObject(), out gpBitmap);
            if (status != 0) return Array.Empty<byte>();

            var clsid = GetJpegEncoderClsid();
            var encoderParams = CreateJpegEncoderParams(70);
            var paramsHandle = GCHandle.Alloc(encoderParams, GCHandleType.Pinned);

            try
            {
                IStream stream = CreateMemoryStream();
                status = GdipSaveImageToStream(gpBitmap, stream, ref clsid, paramsHandle.AddrOfPinnedObject());
                if (status != 0) return Array.Empty<byte>();
                return StreamToBytes(stream);
            }
            finally
            {
                paramsHandle.Free();
                GdipDisposeImage(gpBitmap);
            }
        }
        finally
        {
            handle.Free();
        }
    }

    private static Guid GetJpegEncoderClsid()
    {
        return new Guid("557cf401-1a04-11d3-9a73-0000f81ef32e");
    }

    private static byte[] CreateJpegEncoderParams(int quality)
    {
        var qualityGuid = new Guid("1d5be4b5-fa4a-452d-9cdd-5db35105e7eb");
        byte[] result = new byte[4 + 4 + 16 + 4 + 4 + 8];
        BitConverter.GetBytes(1).CopyTo(result, 0);
        qualityGuid.ToByteArray().CopyTo(result, 4);
        BitConverter.GetBytes(1).CopyTo(result, 20);
        BitConverter.GetBytes(4).CopyTo(result, 24);
        BitConverter.GetBytes((long)quality).CopyTo(result, 28);
        return result;
    }

    private static IStream CreateMemoryStream()
    {
        CreateStreamOnHGlobal(IntPtr.Zero, true, out var stream);
        return stream;
    }

    private static byte[] StreamToBytes(IStream stream)
    {
        stream.Seek(0, 0, IntPtr.Zero);
        var stat = new System.Runtime.InteropServices.ComTypes.STATSTG();
        stream.Stat(out stat, 0);
        int size = (int)stat.cbSize;
        byte[] buffer = new byte[size];
        stream.Read(buffer, size, IntPtr.Zero);
        return buffer;
    }

    private record struct BlockInfo(int X, int Y, int W, int H);

    // --- GDI+ init/shutdown ---
    private IntPtr _gdipToken;

    private void InitGdiPlus()
    {
        if (_gdipToken != IntPtr.Zero) return;
        var input = new GdiplusStartupInput { GdiplusVersion = 1 };
        GdiplusStartup(out _gdipToken, ref input, out _);
    }

    private void ShutdownGdiPlus()
    {
        if (_gdipToken == IntPtr.Zero) return;
        GdiplusShutdown(_gdipToken);
        _gdipToken = IntPtr.Zero;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GdiplusStartupInput
    {
        public int GdiplusVersion;
        public IntPtr DebugEventCallback;
        public int SuppressBackgroundThread;
        public int SuppressExternalCodecs;
    }

    [DllImport("gdiplus.dll")] private static extern int GdiplusStartup(out IntPtr token, ref GdiplusStartupInput input, out IntPtr output);
    [DllImport("gdiplus.dll")] private static extern void GdiplusShutdown(IntPtr token);

    // --- P/Invoke ---
    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;
    private const uint SRCCOPY = 0x00CC0020;
    private const int HALFTONE = 4;
    private const int PixelFormat24bppRGB = 0x00021808;

    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hdc, IntPtr hObject);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr hdcDest, int x, int y, int w, int h, IntPtr hdcSrc, int srcX, int srcY, uint rop);
    [DllImport("gdi32.dll")] private static extern bool StretchBlt(IntPtr hdcDest, int xDest, int yDest, int wDest, int hDest, IntPtr hdcSrc, int xSrc, int ySrc, int wSrc, int hSrc, uint rop);
    [DllImport("gdi32.dll")] private static extern int SetStretchBltMode(IntPtr hdc, int mode);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr hdc, IntPtr hBitmap, uint start, uint lines, byte[] bits, ref BITMAPINFO bmi, uint usage);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdiplus.dll")] private static extern int GdipCreateBitmapFromScan0(int width, int height, int stride, int format, IntPtr scan0, out IntPtr bitmap);
    [DllImport("gdiplus.dll")] private static extern int GdipSaveImageToStream(IntPtr image, IStream stream, ref Guid clsidEncoder, IntPtr encoderParams);
    [DllImport("gdiplus.dll")] private static extern int GdipDisposeImage(IntPtr image);

    [DllImport("ole32.dll")] private static extern int CreateStreamOnHGlobal(IntPtr hGlobal, bool fDeleteOnRelease, out IStream ppstm);

    [ComImport, Guid("0000000c-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IStream
    {
        void Read([MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] byte[] pv, int cb, IntPtr pcbRead);
        void Write([MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] byte[] pv, int cb, IntPtr pcbWritten);
        void Seek(long dlibMove, int dwOrigin, IntPtr plibNewPosition);
        void SetSize(long libNewSize);
        void CopyTo(IStream pstm, long cb, IntPtr pcbRead, IntPtr pcbWritten);
        void Commit(int grfCommitFlags);
        void Revert();
        void LockRegion(long libOffset, long cb, int dwLockType);
        void UnlockRegion(long libOffset, long cb, int dwLockType);
        void Stat(out System.Runtime.InteropServices.ComTypes.STATSTG pstatstg, int grfStatFlag);
        void Clone(out IStream ppstm);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFO
    {
        public BITMAPINFOHEADER bmiHeader;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER
    {
        public int biSize;
        public int biWidth;
        public int biHeight;
        public short biPlanes;
        public short biBitCount;
        public int biCompression;
        public int biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public int biClrUsed;
        public int biClrImportant;
    }
}
