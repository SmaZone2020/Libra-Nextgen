using NAudio.Wave;
using LibraNextgen.Agent.Communication;

namespace LibraNextgen.Agent.Modules.Execution;

public sealed class MicCapture : IDisposable
{
    private readonly WsCommunicator _ws;
    private readonly string _agentId;

    public static string GetDevicesJson()
    {
        try
        {
            var items = new List<string>();
            for (int i = 0; i < WaveInEvent.DeviceCount; i++)
            {
                var caps = WaveInEvent.GetCapabilities(i);
                items.Add($"{{\"index\":{i},\"name\":\"{EscapeJson(caps.ProductName)}\",\"channels\":{caps.Channels}}}");
            }
            return $"[{string.Join(",", items)}]";
        }
        catch
        {
            return "[]";
        }
    }

    private static string EscapeJson(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private int _deviceIndex;
    private WaveInEvent? _waveIn;
    private CancellationTokenSource? _cts;

    private const int SampleRate = 16000;
    private const int BitsPerSample = 16;
    private const int Channels = 1;
    private const int BufferMs = 200;

    public MicCapture(WsCommunicator ws, string agentId)
    {
        _ws = ws;
        _agentId = agentId;
    }

    public void Start(int deviceIndex)
    {
        Stop();
        _deviceIndex = deviceIndex;
        _cts = new CancellationTokenSource();

        try
        {
            if (deviceIndex >= WaveInEvent.DeviceCount)
            {
                _ = _ws.SendResultAsync("mic.error", _agentId,
                    new { error = $"Mic index {deviceIndex} not found. Available: {WaveInEvent.DeviceCount}" });
                return;
            }

            _waveIn = new WaveInEvent
            {
                DeviceNumber = deviceIndex,
                WaveFormat = new WaveFormat(SampleRate, BitsPerSample, Channels),
                BufferMilliseconds = BufferMs
            };

            _waveIn.DataAvailable += OnDataAvailable;
            _waveIn.RecordingStopped += OnRecordingStopped;
            _waveIn.StartRecording();
        }
        catch (Exception ex)
        {
            _ = _ws.SendResultAsync("mic.error", _agentId, new { error = ex.Message });
        }
    }

    public void Stop()
    {
        _cts?.Cancel();
        if (_waveIn != null)
        {
            try { _waveIn.StopRecording(); } catch { }
            _waveIn.DataAvailable -= OnDataAvailable;
            _waveIn.RecordingStopped -= OnRecordingStopped;
            _waveIn.Dispose();
            _waveIn = null;
        }
        _cts?.Dispose();
        _cts = null;
    }

    public void Dispose() => Stop();

    private async void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (_cts?.IsCancellationRequested == true || e.BytesRecorded == 0) return;

        try
        {
            var pcmData = new byte[e.BytesRecorded];
            Buffer.BlockCopy(e.Buffer, 0, pcmData, 0, e.BytesRecorded);

            await _ws.SendResultAsync("mic.data", _agentId, new
            {
                sampleRate = SampleRate,
                channels = Channels,
                bitsPerSample = BitsPerSample,
                data = Convert.ToBase64String(pcmData)
            });
        }
        catch { }
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception != null)
        {
            _ = _ws.SendResultAsync("mic.error", _agentId, new { error = e.Exception.Message });
        }
    }
}
