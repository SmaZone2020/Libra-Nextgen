using System.Diagnostics;
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
    private static List<CameraEntry> _cameraEntries = new();

    private sealed class CameraEntry
    {
        public string Name { get; set; } = "";
        public string Symlink { get; set; } = "";
    }

    // ════════════════════════════════════════════════════════════════════════
    //  SetupAPI — camera enumeration with symlink extraction
    // ════════════════════════════════════════════════════════════════════════

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

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool SetupDiEnumDeviceInterfaces(
        IntPtr DeviceInfoSet,
        IntPtr DeviceInfoData,
        ref Guid InterfaceClassGuid,
        uint MemberIndex,
        ref SP_DEVICE_INTERFACE_DATA DeviceInterfaceData);

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool SetupDiGetDeviceInterfaceDetail(
        IntPtr DeviceInfoSet,
        ref SP_DEVICE_INTERFACE_DATA DeviceInterfaceData,
        IntPtr DeviceInterfaceDetailData,
        uint DeviceInterfaceDetailDataSize,
        out uint RequiredSize,
        IntPtr DeviceInfoData);

    [StructLayout(LayoutKind.Sequential)]
    private struct SP_DEVINFO_DATA
    {
        public uint cbSize;
        public Guid ClassGuid;
        public uint DevInst;
        public IntPtr Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SP_DEVICE_INTERFACE_DATA
    {
        public uint cbSize;
        public Guid InterfaceClassGuid;
        public uint Flags;
        public IntPtr Reserved;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Media Foundation — camera capture
    // ════════════════════════════════════════════════════════════════════════

    private const uint MF_VERSION = 0x00020070; // 2.7
    private const uint MFSTARTUP_NOSOCKET = 0x1;

    // MFAttributes
    private static readonly Guid MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE = new(0xc60ac5fe, 0x252a, 0x478f, 0xa0, 0xef, 0xbc, 0x8f, 0xa5, 0xf7, 0xca, 0xd3);
    private static readonly Guid MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID = new(0x8ac3587a, 0x4ae7, 0x42d8, 0x99, 0xe0, 0x0a, 0x60, 0x13, 0xee, 0xf9, 0x0f);
    private static readonly Guid MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK = new(0x58f0aad8, 0x22bf, 0x4f8a, 0xbb, 0x3d, 0xd2, 0xc4, 0x97, 0x8c, 0x6e, 0x2f);
    private static readonly Guid MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME = new(0xb4d0ac99, 0xfe2a, 0x49d1, 0xb3, 0xc2, 0xa7, 0xde, 0x6d, 0x90, 0x4d, 0x64);
    private static readonly Guid MF_SOURCE_READER_ASYNC_CALLBACK = new(0x1e3dbeac, 0xbb43, 0x4c35, 0xb5, 0x07, 0xcd, 0x64, 0x44, 0x64, 0xc9, 0x65);
    private static readonly Guid MF_MT_MAJOR_TYPE = new(0x48eba18e, 0xf8c9, 0x4687, 0xbf, 0x11, 0x0a, 0x74, 0xc9, 0xf9, 0x6a, 0x8f);
    private static readonly Guid MF_MT_SUBTYPE = new(0xf7e34c9a, 0x42e8, 0x4714, 0xb7, 0x4b, 0xcb, 0x29, 0xd7, 0x2c, 0x35, 0xe5);
    private static readonly Guid MF_MT_FRAME_SIZE = new(0x1652c33d, 0xd6b2, 0x4012, 0xb8, 0x34, 0x72, 0x03, 0x08, 0x49, 0xa3, 0x7d);
    private static readonly Guid MF_MT_FRAME_RATE = new(0xc459a2e8, 0x3d2c, 0x4e44, 0xb1, 0x32, 0xfe, 0xe5, 0x15, 0x6c, 0x7e, 0xe0);

    private static readonly Guid MFMediaType_Video = new(0x73646976, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71);
    private static readonly Guid MFVideoFormat_NV12 = new(0x3231564E, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71);
    private static readonly Guid IID_IMFMediaSource = new("279A808D-AEC7-40C8-9C6B-A6B492C78A66");

    [DllImport("mfplat.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int MFStartup(uint Version, uint dwFlags);

    [DllImport("mfplat.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int MFShutdown();

    [DllImport("mfplat.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int MFCreateAttributes(out IntPtr ppMFAttributes, uint cInitialSize);

    [DllImport("mf.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int MFEnumDeviceSources(IntPtr pAttributes, out IntPtr pppSourceActivate, out uint pcSourceActivate);

    [DllImport("mfreadwrite.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int MFCreateSourceReaderFromMediaSource(IntPtr pMediaSource, IntPtr pAttributes, out IntPtr ppSourceReader);

    // ════════════════════════════════════════════════════════════════════════
    //  Raw COM vtable delegates (NativeAOT compatible — no [ComImport])
    // ════════════════════════════════════════════════════════════════════════

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int ActivateObjectDelegate(IntPtr pThis, IntPtr riid, IntPtr ppv);

    // IMFAttributes::SetGUID — vtable slot 24 (IUnknown:3 + SetGUID is index 21 in IMFAttributes)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SetGUIDDelegate(IntPtr pThis, IntPtr guidKey, IntPtr guidValue);

    // IMFAttributes::GetUINT64 — vtable slot 8 (IUnknown:3 + index 5)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetUINT64Delegate(IntPtr pThis, IntPtr guidKey, out ulong punValue);

    // IMFSourceReader::SetCurrentMediaType — vtable slot 7 (IUnknown:3 + index 4)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SetCurrentMediaTypeDelegate(IntPtr pThis, int dwStreamIndex, IntPtr pdwReserved, IntPtr pMediaType);

    // IMFSourceReader::ReadSample — vtable slot 9 (IUnknown:3 + index 6)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int ReadSampleDelegate(IntPtr pThis, int dwStreamIndex, int dwControlFlags, out int pdwActualStreamIndex, out int pdwStreamFlags, out long pllTimestamp, out IntPtr ppSample);

    // IMFSourceReader::GetCurrentMediaType — vtable slot 6 (IUnknown:3 + index 3)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetCurrentMediaTypeDelegate(IntPtr pThis, int dwStreamIndex, out IntPtr ppMediaType);

    // IMFSample::GetBufferByIndex — vtable slot 40 (IUnknown:3 + IMFAttributes:30 + IMFSample own: GetSampleFlags(0) SetSampleFlags(1) GetSampleTime(2) SetSampleTime(3) GetSampleDuration(4) SetSampleDuration(5) GetBufferCount(6) GetBufferByIndex(7))
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetBufferByIndexDelegate(IntPtr pThis, uint dwIndex, out IntPtr ppBuffer);

    // IMFMediaBuffer::Lock — vtable slot 3 (IUnknown:3 + index 0)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int BufferLockDelegate(IntPtr pThis, out IntPtr ppbBuffer, out uint pcbMaxLength, out uint pcbCurrentLength);

    // IMFMediaBuffer::Unlock — vtable slot 4 (IUnknown:3 + index 1)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int BufferUnlockDelegate(IntPtr pThis);

    // IUnknown::Release — vtable slot 2
    private static int ComRelease(IntPtr pUnk)
    {
        if (pUnk == IntPtr.Zero) return 0;
        var vtbl = Marshal.ReadIntPtr(pUnk);
        var release = Marshal.GetDelegateForFunctionPointer<ReleaseDelegate>(Marshal.ReadIntPtr(vtbl + 2 * IntPtr.Size));
        return release(pUnk);
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int ReleaseDelegate(IntPtr pThis);

    private static IntPtr VtSlot(IntPtr pObj, int slot)
    {
        var vtbl = Marshal.ReadIntPtr(pObj);
        return Marshal.ReadIntPtr(vtbl + slot * IntPtr.Size);
    }

    private static int Attrs_SetGUID(IntPtr pAttrs, Guid key, Guid value)
    {
        var pKey = Marshal.AllocHGlobal(16);
        var pVal = Marshal.AllocHGlobal(16);
        Marshal.Copy(key.ToByteArray(), 0, pKey, 16);
        Marshal.Copy(value.ToByteArray(), 0, pVal, 16);
        try
        {
            var fn = Marshal.GetDelegateForFunctionPointer<SetGUIDDelegate>(VtSlot(pAttrs, 24));
            return fn(pAttrs, pKey, pVal);
        }
        finally
        {
            Marshal.FreeHGlobal(pKey);
            Marshal.FreeHGlobal(pVal);
        }
    }

    private static int Attrs_GetUINT64(IntPtr pAttrs, Guid key, out ulong value)
    {
        var pKey = Marshal.AllocHGlobal(16);
        Marshal.Copy(key.ToByteArray(), 0, pKey, 16);
        try
        {
            var fn = Marshal.GetDelegateForFunctionPointer<GetUINT64Delegate>(VtSlot(pAttrs, 8));
            return fn(pAttrs, pKey, out value);
        }
        finally
        {
            Marshal.FreeHGlobal(pKey);
        }
    }

    // IMFAttributes::GetString — vtable slot 12 (IUnknown:3 + index 9)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetStringDelegate(IntPtr pThis, IntPtr guidKey, IntPtr pwszValue, uint cchBufSize, out uint pcchLength);

    private static string Attrs_GetString(IntPtr pAttrs, Guid key)
    {
        var pKey = Marshal.AllocHGlobal(16);
        Marshal.Copy(key.ToByteArray(), 0, pKey, 16);
        var buf = Marshal.AllocHGlobal(1024);
        try
        {
            var fn = Marshal.GetDelegateForFunctionPointer<GetStringDelegate>(VtSlot(pAttrs, 12));
            int hr = fn(pAttrs, pKey, buf, 512, out var len);
            if (hr != 0) return "";
            return Marshal.PtrToStringUni(buf, (int)len) ?? "";
        }
        finally
        {
            Marshal.FreeHGlobal(pKey);
            Marshal.FreeHGlobal(buf);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  GDI+ Flat API — JPEG encoding
    // ════════════════════════════════════════════════════════════════════════

    private static readonly Guid JpegEncoderClsid = new(0x557CF401, 0x1A04, 0x11D3, 0x9A, 0x73, 0x00, 0x00, 0xF8, 0x1E, 0xF3, 0x2E);

    [DllImport("gdiplus.dll", SetLastError = true)]
    private static extern int GdipCreateBitmapFromScan0(int width, int height, int stride, int format, IntPtr scan0, out IntPtr bitmap);

    [DllImport("gdiplus.dll", SetLastError = true)]
    private static extern int GdipSaveImageToStream(IntPtr image, IntPtr stream, [MarshalAs(UnmanagedType.LPStruct)] Guid clsidEncoder, IntPtr encoderParams);

    [DllImport("gdiplus.dll", SetLastError = true)]
    private static extern int GdipDisposeImage(IntPtr image);

    [DllImport("ole32.dll")]
    private static extern int CreateStreamOnHGlobal(IntPtr hGlobal, [MarshalAs(UnmanagedType.Bool)] bool fDeleteOnRelease, out IntPtr ppstm);

    [DllImport("ole32.dll")]
    private static extern int CLSIDFromString([MarshalAs(UnmanagedType.LPWStr)] string lpsz, out Guid pclsid);

    // GDI+ startup/shutdown
    private static IntPtr _gdiplusToken;
    private static bool _gdiplusStarted;

    [StructLayout(LayoutKind.Sequential)]
    private struct GdiplusStartupInput
    {
        public uint GdiplusVersion;
        public IntPtr DebugEventCallback;
        public int SuppressBackgroundThread;
        public int SuppressExternalCodecs;
    }

    [DllImport("gdiplus.dll", SetLastError = true)]
    private static extern int GdiplusStartup(out IntPtr token, ref GdiplusStartupInput input, IntPtr output);

    [DllImport("gdiplus.dll", SetLastError = true)]
    private static extern void GdiplusShutdown(IntPtr token);

    // ════════════════════════════════════════════════════════════════════════
    //  Public API
    // ════════════════════════════════════════════════════════════════════════

    public static string GetDevicesJson()
    {
        _cameraEntries.Clear();
        Console.WriteLine("[Camera] Enumerating devices...");

        // Try Media Foundation enumeration first
        try
        {
            if (MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET) == 0)
            {
                try
                {
                    var json = EnumerateViaMF();
                    if (!string.IsNullOrEmpty(json))
                    {
                        Console.WriteLine($"[Camera] MF enumeration OK: {_cameraEntries.Count} device(s)");
                        return json;
                    }
                    Console.WriteLine("[Camera] MF enumeration returned no devices");
                }
                finally
                {
                    MFShutdown();
                }
            }
            else
            {
                Console.WriteLine("[Camera] MFStartup failed, skipping MF enumeration");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Camera] MF enumeration failed: {ex.Message}");
        }

        // Fall back to SetupAPI + WMI
        Console.WriteLine("[Camera] Trying SetupAPI...");
        var result = GetDevicesViaSetupApi();
        if (result != null)
        {
            Console.WriteLine($"[Camera] SetupAPI OK: {_cameraEntries.Count} device(s)");
            return result;
        }

        Console.WriteLine("[Camera] SetupAPI returned no devices, trying WMI...");
        result = GetDevicesViaWmi();
        ParseDeviceNamesFromJson(result);
        Console.WriteLine($"[Camera] WMI result: {_cameraEntries.Count} device(s), json={result}");
        return result;
    }

    private static string? EnumerateViaMF()
    {
        int hr = MFCreateAttributes(out var pAttrs, 1);
        Console.WriteLine($"[Camera] MF MFCreateAttributes hr=0x{hr:X8}");
        if (hr != 0) return null;

        Attrs_SetGUID(pAttrs, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);

        hr = MFEnumDeviceSources(pAttrs, out var activatePtr, out var count);
        ComRelease(pAttrs);
        Console.WriteLine($"[Camera] MF MFEnumDeviceSources hr=0x{hr:X8}, count={count}");
        if (hr != 0 || count == 0) return null;

        var entries = new List<CameraEntry>();
        var activateSize = IntPtr.Size;

        for (uint i = 0; i < count; i++)
        {
            var rawPtr = Marshal.ReadIntPtr(activatePtr + (int)(i * activateSize));
            if (rawPtr == IntPtr.Zero) continue;

            string name = $"Camera {i}";
            var n = Attrs_GetString(rawPtr, MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME);
            if (!string.IsNullOrEmpty(n)) name = n;

            string symlink = Attrs_GetString(rawPtr, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK);

            if (!string.IsNullOrEmpty(symlink))
            {
                Console.WriteLine($"[Camera] MF device {i}: '{name}' symlink={symlink}");
                entries.Add(new CameraEntry { Name = name, Symlink = symlink });
            }
        }

        for (uint i = 0; i < count; i++)
        {
            var rawPtr = Marshal.ReadIntPtr(activatePtr + (int)(i * activateSize));
            if (rawPtr != IntPtr.Zero)
                ComRelease(rawPtr);
        }
        Marshal.FreeCoTaskMem(activatePtr);

        if (entries.Count == 0) return null;

        _cameraEntries = entries;

        var sb = new StringBuilder("[");
        for (int i = 0; i < entries.Count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append($"{{\"index\":{i},\"name\":\"{EscapeJson(entries[i].Name)}\",\"characteristics\":[]}}");
        }
        sb.Append(']');

        var json = sb.ToString();
        Console.WriteLine($"[Camera] Found {entries.Count} camera(s) via MF");
        return json;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  SetupAPI enumeration (fallback)
    // ════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Enumerate cameras via SetupAPI — gets both friendly name AND device path (symlink).
    /// Uses SetupDiEnumDeviceInterfaces + SetupDiGetDeviceInterfaceDetail to get the
    /// real device path (e.g. \\?\usb#vid...) that Media Foundation requires.
    /// </summary>
    private static string? GetDevicesViaSetupApi()
    {
        try
        {
            var entries = new List<CameraEntry>();
            var guid = KSCATEGORY_VIDEO_CAMERA;
            var hDevInfo = SetupDiGetClassDevs(ref guid, null, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);

            if (hDevInfo == IntPtr.Zero || hDevInfo == new IntPtr(-1))
                return null;

            try
            {
                uint idx = 0;
                var ifaceData = new SP_DEVICE_INTERFACE_DATA { cbSize = (uint)Marshal.SizeOf<SP_DEVICE_INTERFACE_DATA>() };

                while (SetupDiEnumDeviceInterfaces(hDevInfo, IntPtr.Zero, ref guid, idx++, ref ifaceData))
                {
                    SetupDiGetDeviceInterfaceDetail(hDevInfo, ref ifaceData, IntPtr.Zero, 0, out var requiredSize, IntPtr.Zero);
                    if (requiredSize == 0) { ifaceData = new SP_DEVICE_INTERFACE_DATA { cbSize = (uint)Marshal.SizeOf<SP_DEVICE_INTERFACE_DATA>() }; continue; }

                    var detailPtr = Marshal.AllocHGlobal((int)requiredSize);
                    try
                    {
                        Marshal.WriteInt32(detailPtr, IntPtr.Size == 8 ? 8 : 6);
                        if (!SetupDiGetDeviceInterfaceDetail(hDevInfo, ref ifaceData, detailPtr, requiredSize, out _, IntPtr.Zero))
                            continue;

                        var symlink = Marshal.PtrToStringUni(detailPtr + 4);
                        if (string.IsNullOrEmpty(symlink)) continue;

                        // Extract a readable name from the symlink (e.g. "FHD Camera" from "\\?\usb#vid_...")
                        var name = CameraNameFromSymlink(symlink);

                        Console.WriteLine($"[Camera] SetupAPI: '{name}' -> {symlink}");
                        entries.Add(new CameraEntry { Name = name, Symlink = symlink });
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(detailPtr);
                    }

                    ifaceData = new SP_DEVICE_INTERFACE_DATA { cbSize = (uint)Marshal.SizeOf<SP_DEVICE_INTERFACE_DATA>() };
                }
            }
            finally
            {
                SetupDiDestroyDeviceInfoList(hDevInfo);
            }

            if (entries.Count > 0)
            {
                _cameraEntries = entries;
                var sb = new StringBuilder("[");
                for (int i = 0; i < entries.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append($"{{\"index\":{i},\"name\":\"{EscapeJson(entries[i].Name)}\",\"characteristics\":[]}}");
                }
                sb.Append(']');
                Console.WriteLine($"[Camera] Found {entries.Count} camera(s) via SetupAPI (with symlinks)");
                return sb.ToString();
            }
            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Camera] SetupAPI failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>Extract a human-readable camera name from a device symlink path.</summary>
    private static string CameraNameFromSymlink(string symlink)
    {
        // symlink looks like: \\?\usb#vid_13d3&pid_1288&mi_00#6&1f2c3a4d&0&0000#{e5323777-f976-4f5b-9b55-b94699c46e44}\global
        // Extract VID/PID or use the last meaningful segment
        try
        {
            // Find the part after the last '#' that's not a GUID
            var parts = symlink.Split('#');
            // Look for a segment like "vid_13d3&pid_1288"
            foreach (var part in parts)
            {
                var lower = part.ToLowerInvariant();
                if (lower.Contains("vid_") && lower.Contains("pid_"))
                {
                    // Try to match with a known camera name from WMI
                    return part;
                }
            }
        }
        catch { }
        return symlink;
    }

    /// <summary>Enumerate cameras via PowerShell / WMI. Constructs the MF-compatible
    /// device symlink from the WMI DeviceID (e.g. USB\VID_... → \\?\USB#VID_...#{guid}\global).</summary>
    private static string GetDevicesViaWmi()
    {
        var outFile = Path.GetTempFileName();
        var cameraGuid = KSCATEGORY_VIDEO_CAMERA.ToString("B"); // {E5323777-F976-4F5B-9B55-B94699C46E44}
        try
        {
            var psScript = """
                $ProgressPreference = 'SilentlyContinue'
                $ErrorActionPreference = 'Stop'
                $outFile = '__OUTFILE__'
                $cameraGuid = '__CAMGUID__'
                $cameras = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Image' -or $_.PNPClass -eq 'Camera' })
                $i = 0
                $result = foreach ($cam in $cameras) {
                    if ($cam.Caption -and $cam.Caption -notlike 'root*') {
                        $symlink = "\\?\" + $cam.DeviceID.Replace('\', '#') + "#" + $cameraGuid + "\global"
                        [PSCustomObject]@{ index = $i; name = $cam.Caption; characteristics = @(); symlink = $symlink }
                        $i++
                    }
                }
                @($result) | ConvertTo-Json | Out-File -FilePath $outFile -Encoding UTF8
                """
                .Replace("__OUTFILE__", outFile.Replace("\\", "/"))
                .Replace("__CAMGUID__", cameraGuid);

            var bytes = Encoding.Unicode.GetBytes(psScript);
            var base64 = Convert.ToBase64String(bytes);

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -EncodedCommand {base64}",
                RedirectStandardOutput = false,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var proc = Process.Start(psi);
            if (proc == null) return "[]";

            proc.WaitForExit(15000);

            if (proc.ExitCode != 0)
            {
                var stderr = proc.StandardError.ReadToEnd();
                Console.WriteLine($"[Camera] PS exit={proc.ExitCode}, stderr: {stderr}");
            }

            if (File.Exists(outFile))
            {
                var json = File.ReadAllText(outFile, Encoding.UTF8).Trim();
                if (!string.IsNullOrEmpty(json) && json != "[]")
                {
                    if (json[0] == '{')
                        json = $"[{json}]";
                    Console.WriteLine($"[Camera] PS/WMI: {json}");
                    return json;
                }
            }

            Console.WriteLine("[Camera] PS/WMI returned no cameras");
            return "[]";
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Camera] PowerShell/WMI failed: {ex.Message}");
            return "[]";
        }
        finally
        {
            try { File.Delete(outFile); } catch { }
        }
    }

    private static void ParseDeviceNamesFromJson(string json)
    {
        try
        {
            json = json.Trim();
            Console.WriteLine($"[Camera] ParseDeviceNames: input(len={json.Length}): {json}");
            if (json.Length < 6) { Console.WriteLine("[Camera] ParseDeviceNames: too short"); return; }

            if (json[0] == '{')
            {
                var name = ExtractJsonStringField(json, "name");
                var symlink = ExtractJsonStringField(json, "symlink");
                if (string.IsNullOrEmpty(symlink)) symlink = name;
                Console.WriteLine($"[Camera] ParseDeviceNames: object, name='{name}', symlink='{symlink}'");
                if (!string.IsNullOrEmpty(name))
                    _cameraEntries.Add(new CameraEntry { Name = name, Symlink = symlink });
                return;
            }

            if (json[0] != '[') { Console.WriteLine($"[Camera] ParseDeviceNames: not object/array, first char='{json[0]}'"); return; }

            int depth = 0, objStart = -1;
            for (int i = 0; i < json.Length; i++)
            {
                if (json[i] == '{')
                {
                    if (depth == 0) objStart = i;
                    depth++;
                }
                else if (json[i] == '}')
                {
                    depth--;
                    if (depth == 0 && objStart >= 0)
                    {
                        var objJson = json[objStart..(i + 1)];
                        var name = ExtractJsonStringField(objJson, "name");
                        var symlink = ExtractJsonStringField(objJson, "symlink");
                        if (string.IsNullOrEmpty(symlink)) symlink = name;
                        Console.WriteLine($"[Camera] ParseDeviceNames: array[{i}], name='{name}', symlink='{symlink}'");
                        if (!string.IsNullOrEmpty(name))
                            _cameraEntries.Add(new CameraEntry { Name = name, Symlink = symlink });
                        objStart = -1;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Camera] ParseDeviceNames error: {ex.Message}");
        }
    }

    private static string ExtractJsonStringField(string json, string fieldName)
    {
        // Find "\"fieldName\"" then skip optional whitespace + colon + optional whitespace + opening quote
        var key = $"\"{fieldName}\"";
        var keyPos = json.IndexOf(key);
        if (keyPos < 0) return "";
        var afterKey = keyPos + key.Length;
        // Skip whitespace, colon, whitespace, opening quote
        var valStart = -1;
        for (int i = afterKey; i < json.Length; i++)
        {
            if (json[i] == '"') { valStart = i + 1; break; }
            if (json[i] != ' ' && json[i] != '\t' && json[i] != '\n' && json[i] != '\r' && json[i] != ':') break;
        }
        if (valStart < 0) return "";
        var valEnd = json.IndexOf('"', valStart);
        if (valEnd < 0) return "";
        return UnescapeJsonString(json[valStart..valEnd]);
    }

    private static string UnescapeJsonString(string s)
    {
        var sb = new StringBuilder(s.Length);
        for (int i = 0; i < s.Length; i++)
        {
            if (s[i] == '\\' && i + 1 < s.Length)
            {
                switch (s[i + 1])
                {
                    case '\\': sb.Append('\\'); i++; break;
                    case '"':  sb.Append('"');  i++; break;
                    case 'n':  sb.Append('\n'); i++; break;
                    case 'r':  sb.Append('\r'); i++; break;
                    case 't':  sb.Append('\t'); i++; break;
                    case 'u' when i + 5 < s.Length:
                        var hex = s.Substring(i + 2, 4);
                        if (int.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out int cp))
                        {
                            sb.Append((char)cp);
                            i += 5;
                        }
                        else sb.Append(s[i]);
                        break;
                    default: sb.Append(s[i]); break;
                }
            }
            else sb.Append(s[i]);
        }
        return sb.ToString();
    }

    private static string GetDeviceName(IntPtr hDevInfo, ref SP_DEVINFO_DATA devData)
    {
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

    private static string EscapeJson(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (char c in s)
        {
            switch (c)
            {
                case '\\': sb.Append("\\\\"); break;
                case '"': sb.Append("\\\""); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                default:
                    if (c < 0x20)
                        sb.Append($"\\u{(int)c:X4}");
                    else
                        sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Constructor / Lifecycle
    // ════════════════════════════════════════════════════════════════════════

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

        Console.WriteLine($"[Camera] Start requested: fps={fps}, index={cameraIndex}, entries={_cameraEntries.Count}");
        _ = Task.Run(() => CaptureLoop(cameraIndex, _cts.Token));
    }

    public void Stop()
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _cts = null;
    }

    public void SetFps(int fps) => _fps = Math.Clamp(fps, 1, 30);

    public void Dispose() => Stop();

    // ════════════════════════════════════════════════════════════════════════
    //  MF Capture Loop
    // ════════════════════════════════════════════════════════════════════════

    private async Task CaptureLoop(int cameraIndex, CancellationToken ct)
    {
        int hr = MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);
        if (hr != 0)
        {
            ReportError($"MFStartup failed: 0x{hr:X8}");
            return;
        }

        IntPtr pSourceReader = IntPtr.Zero;
        try
        {
            hr = MFCreateAttributes(out var pEnumAttrs, 1);
            if (hr != 0) { ReportError($"MFCreateAttributes(enum) failed: 0x{hr:X8}"); return; }

            Attrs_SetGUID(pEnumAttrs, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);

            hr = MFEnumDeviceSources(pEnumAttrs, out var activatePtr, out var count);
            ComRelease(pEnumAttrs);
            if (hr != 0 || count == 0) { ReportError($"MFEnumDeviceSources failed: 0x{hr:X8}, count={count}"); return; }

            Console.WriteLine($"[Camera] Capture: MFEnumDeviceSources found {count} device(s), requesting index {cameraIndex}");

            if (cameraIndex >= count)
            {
                ReportError($"Camera index {cameraIndex} out of range (have {count} devices)");
                return;
            }

            var pActivate = Marshal.ReadIntPtr(activatePtr + cameraIndex * IntPtr.Size);

            // ActivateObject: vtable slot 33 (IUnknown:3 + IMFAttributes:30 + ActivateObject:0)
            var iidSource = IID_IMFMediaSource;
            var pIid = Marshal.AllocHGlobal(16);
            Marshal.Copy(iidSource.ToByteArray(), 0, pIid, 16);
            var ppSource = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(ppSource, IntPtr.Zero);

            var activateObjectDel = Marshal.GetDelegateForFunctionPointer<ActivateObjectDelegate>(VtSlot(pActivate, 33));
            hr = activateObjectDel(pActivate, pIid, ppSource);
            var pMediaSource = Marshal.ReadIntPtr(ppSource);
            Marshal.FreeHGlobal(pIid);
            Marshal.FreeHGlobal(ppSource);

            for (uint i = 0; i < count; i++)
                ComRelease(Marshal.ReadIntPtr(activatePtr + (int)(i * IntPtr.Size)));
            Marshal.FreeCoTaskMem(activatePtr);

            if (hr != 0 || pMediaSource == IntPtr.Zero)
            {
                ReportError($"ActivateObject failed: 0x{hr:X8}");
                return;
            }
            Console.WriteLine("[Camera] ActivateObject succeeded");

            hr = MFCreateSourceReaderFromMediaSource(pMediaSource, IntPtr.Zero, out pSourceReader);
            ComRelease(pMediaSource);
            if (hr != 0 || pSourceReader == IntPtr.Zero) { ReportError($"MFCreateSourceReaderFromMediaSource failed: 0x{hr:X8}"); return; }

            // Set output to NV12
            hr = MFCreateAttributes(out var pMtAttrs, 2);
            if (hr == 0)
            {
                Attrs_SetGUID(pMtAttrs, MF_MT_MAJOR_TYPE, MFMediaType_Video);
                Attrs_SetGUID(pMtAttrs, MF_MT_SUBTYPE, MFVideoFormat_NV12);
                // IMFSourceReader::SetCurrentMediaType is slot 7 (IUnknown:3 + index 4)
                var setMtFn = Marshal.GetDelegateForFunctionPointer<SetCurrentMediaTypeDelegate>(VtSlot(pSourceReader, 7));
                setMtFn(pSourceReader, 0, IntPtr.Zero, pMtAttrs);
                ComRelease(pMtAttrs);
            }

            Console.WriteLine($"[Camera] MF capture started, fps={_fps}");

            var interval = 1000 / _fps;
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(interval, ct);

                // IMFSourceReader::ReadSample is slot 9 (IUnknown:3 + index 6)
                var readFn = Marshal.GetDelegateForFunctionPointer<ReadSampleDelegate>(VtSlot(pSourceReader, 9));
                hr = readFn(pSourceReader, 0, 0, out _, out var flags, out _, out var pSample);
                if (hr != 0 || pSample == IntPtr.Zero) continue;

                try
                {
                    // IMFSample::GetBufferByIndex is slot 40 (IUnknown:3 + IMFAttributes:30 + own: 7)
                    var getBufFn = Marshal.GetDelegateForFunctionPointer<GetBufferByIndexDelegate>(VtSlot(pSample, 40));
                    hr = getBufFn(pSample, 0, out var pBuffer);
                    if (hr != 0 || pBuffer == IntPtr.Zero) continue;

                    // IMFMediaBuffer::Lock is slot 3 (IUnknown:3 + index 0)
                    var lockFn = Marshal.GetDelegateForFunctionPointer<BufferLockDelegate>(VtSlot(pBuffer, 3));
                    hr = lockFn(pBuffer, out var dataPtr, out _, out var dataLen);
                    if (hr != 0) { ComRelease(pBuffer); continue; }

                    var frameData = new byte[dataLen];
                    Marshal.Copy(dataPtr, frameData, 0, (int)dataLen);

                    // IMFMediaBuffer::Unlock is slot 4
                    var unlockFn = Marshal.GetDelegateForFunctionPointer<BufferUnlockDelegate>(VtSlot(pBuffer, 4));
                    unlockFn(pBuffer);
                    ComRelease(pBuffer);

                    // Get frame dimensions from current media type
                    int width = 640, height = 480;
                    var getMtFn = Marshal.GetDelegateForFunctionPointer<GetCurrentMediaTypeDelegate>(VtSlot(pSourceReader, 6));
                    hr = getMtFn(pSourceReader, 0, out var pMediaType);
                    if (hr == 0 && pMediaType != IntPtr.Zero)
                    {
                        if (Attrs_GetUINT64(pMediaType, MF_MT_FRAME_SIZE, out var frameSize) == 0)
                        {
                            width = (int)(frameSize >> 32);
                            height = (int)(frameSize & 0xFFFFFFFF);
                        }
                        ComRelease(pMediaType);
                    }

                    var jpeg = Nv12ToJpeg(frameData, width, height);
                    if (jpeg.Length > 0)
                    {
                        var base64 = Convert.ToBase64String(jpeg);
                        _ = _ws.SendResultRawAsync("camera.frame", _agentId,
                            $$"""{"data":"{{base64}}"}""");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[Camera] Frame error: {ex.Message}");
                }
                finally
                {
                    ComRelease(pSample);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            if (!ct.IsCancellationRequested)
                ReportError(ex.Message);
        }
        finally
        {
            if (pSourceReader != IntPtr.Zero) ComRelease(pSourceReader);
            MFShutdown();
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  NV12 → RGB → JPEG (via GDI+ flat API)
    // ════════════════════════════════════════════════════════════════════════

    private static byte[] Nv12ToJpeg(byte[] nv12, int width, int height)
    {
        try
        {
            // NV12 to RGB conversion
            var rgb = Nv12ToRgb(nv12, width, height);
            // RGB to JPEG via GDI+
            return RgbToJpeg(rgb, width, height);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Camera] JPEG encode error: {ex.Message}");
            return Array.Empty<byte>();
        }
    }

    private static byte[] Nv12ToRgb(byte[] nv12, int width, int height)
    {
        var rgb = new byte[width * height * 4]; // 32bpp BGRA
        int yPlaneSize = width * height;
        int uvOffset = yPlaneSize;

        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                int yVal = nv12[y * width + x];
                int uvIndex = uvOffset + (y / 2) * width + (x & ~1);
                int uVal = nv12[uvIndex] - 128;
                int vVal = nv12[uvIndex + 1] - 128;

                int c = yVal - 16;
                int r = (298 * c + 409 * vVal + 128) >> 8;
                int g = (298 * c - 100 * uVal - 208 * vVal + 128) >> 8;
                int b = (298 * c + 516 * uVal + 128) >> 8;

                int dstIdx = y * width * 4 + x * 4;
                rgb[dstIdx] = Clamp(b);  // B
                rgb[dstIdx + 1] = Clamp(g); // G
                rgb[dstIdx + 2] = Clamp(r); // R
                rgb[dstIdx + 3] = 255;      // A
            }
        }
        return rgb;
    }

    private static byte Clamp(int v) => (byte)(v < 0 ? 0 : v > 255 ? 255 : v);

    private static readonly object _gdiLock = new();

    private static byte[] RgbToJpeg(byte[] rgb, int width, int height)
    {
        lock (_gdiLock)
        {
            EnsureGdiplus();

            var handle = GCHandle.Alloc(rgb, GCHandleType.Pinned);
            try
            {
                // 2498570 = PixelFormat.Format32bppRgb (BGRA in GDI+)
                int hr = GdipCreateBitmapFromScan0(width, height, width * 4, 0x26200A, handle.AddrOfPinnedObject(), out var bitmap);
                if (hr != 0) return Array.Empty<byte>();

                try
                {
                    // Create an IStream over an HGlobal
                    CreateStreamOnHGlobal(IntPtr.Zero, true, out var stream);

                    try
                    {
                        hr = GdipSaveImageToStream(bitmap, stream, JpegEncoderClsid, IntPtr.Zero);
                        if (hr != 0) return Array.Empty<byte>();

                        // Extract bytes from the stream
                        GetHGlobalFromStream(stream, out var hglobal);
                        if (hglobal == IntPtr.Zero) return Array.Empty<byte>();
                        int size = (int)GlobalSize(hglobal);
                        if (size <= 0) return Array.Empty<byte>();

                        var lockedPtr = GlobalLock(hglobal);
                        if (lockedPtr == IntPtr.Zero) return Array.Empty<byte>();
                        try
                        {
                            var jpeg = new byte[size];
                            Marshal.Copy(lockedPtr, jpeg, 0, size);
                            return jpeg;
                        }
                        finally
                        {
                            GlobalUnlock(hglobal);
                        }
                    }
                    finally
                    {
                        Marshal.Release(stream);
                    }
                }
                finally
                {
                    GdipDisposeImage(bitmap);
                }
            }
            finally
            {
                handle.Free();
            }
        }
    }

    [DllImport("ole32.dll")]
    private static extern int GetHGlobalFromStream(IntPtr pstm, out IntPtr phglobal);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalSize(IntPtr hMem);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalLock(IntPtr hMem);
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalUnlock(IntPtr hMem);

    private static void EnsureGdiplus()
    {
        if (_gdiplusStarted) return;
        var input = new GdiplusStartupInput { GdiplusVersion = 1 };
        GdiplusStartup(out _gdiplusToken, ref input, IntPtr.Zero);
        _gdiplusStarted = true;
    }

    // ════════════════════════════════════════════════════════════════════════

    private void ReportError(string msg)
    {
        Console.WriteLine($"[Camera] Error: {msg}");
        _ = _ws.SendResultRawAsync("camera.error", _agentId, $$"""{"error":"{{EscapeJson(msg)}}"}""");
    }
}
