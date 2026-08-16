using System.Text;

namespace LibraNextgen.Common.Pe;

/// <summary>Metadata to embed into a Windows PE via the resource section.</summary>
public sealed class PeMetadata
{
    public string? CompanyName { get; set; }
    public string? FileDescription { get; set; }
    public string? ProductName { get; set; }
    public string? FileVersion { get; set; }
    public string? ProductVersion { get; set; }
    public string? Copyright { get; set; }
    /// <summary>Raw .ico file bytes, or null to skip the icon.</summary>
    public byte[]? Icon { get; set; }
}

/// <summary>
/// Pure managed (.NET) writer that merges version info and an icon into a
/// Windows Portable Executable. No native Windows API or external tool is used,
/// so it works regardless of the host OS (Linux/macOS/Windows).
/// </summary>
public static class PeResourceWriter
{
    private const ushort ImageDirectoryEntryResource = 2;
    private const int RtIcon = 3;
    private const int RtGroupIcon = 14;
    private const int RtVersion = 16;

    public static byte[] Embed(byte[] pe, PeMetadata metadata)
    {
        var reader = new PeReader(pe);

        // Flatten existing resources so we preserve them (manifest, etc.).
        var entries = reader.ReadResources();

        if (!string.IsNullOrEmpty(metadata.CompanyName) ||
            !string.IsNullOrEmpty(metadata.FileDescription) ||
            !string.IsNullOrEmpty(metadata.ProductName) ||
            !string.IsNullOrEmpty(metadata.FileVersion) ||
            !string.IsNullOrEmpty(metadata.ProductVersion) ||
            !string.IsNullOrEmpty(metadata.Copyright))
        {
            entries.Add(new ResourceEntry(RtVersion, 1, 0x0409_04B0, BuildVersionInfo(metadata)));
        }

        if (metadata.Icon is { Length: > 0 })
        {
            AddIconResources(entries, metadata.Icon);
        }

        var (tree, dataBlobs, dataPositions) = SerializeResourceTree(entries);
        return reader.Rebuild(tree, dataBlobs, dataPositions);
    }

    /// <summary>Reads and flattens the resources of a PE (useful for tests/tooling).</summary>
    public static List<ResourceEntry> ReadResources(byte[] pe) => new PeReader(pe).ReadResources();

    // ── Version info ─────────────────────────────────────────────────────

    private static byte[] BuildVersionInfo(PeMetadata m)
    {
        var strings = new List<(string Key, string Value)>();
        Add(strings, "CompanyName", m.CompanyName);
        Add(strings, "FileDescription", m.FileDescription);
        Add(strings, "ProductName", m.ProductName);
        Add(strings, "FileVersion", m.FileVersion);
        Add(strings, "ProductVersion", m.ProductVersion);
        Add(strings, "LegalCopyright", m.Copyright);
        Add(strings, "OriginalFilename", null); // optional

        var fixedInfo = BuildFixedFileInfo(m.FileVersion, m.ProductVersion);
        var stringTable = BuildStringTable(strings);
        var varInfo = BuildVarFileInfo();

        using var ms = new MemoryStream();
        var w = new BinaryWriter(ms, Encoding.Unicode);

        int stringFileInfoLen = 6 + Align4((14 * 2)) + stringTable.Length; // header(6) + key(14*2) + table
        int totalLen = 6 + Align4(15 * 2) + fixedInfo.Length + stringFileInfoLen + varInfo.Length;

        // VS_VERSIONINFO header
        w.Write((ushort)totalLen);
        w.Write((ushort)fixedInfo.Length); // wValueLength (in bytes)
        w.Write((ushort)0);                // wType = binary
        WritePadded(w, "VS_VERSION_INFO");
        w.Write(fixedInfo);
        Pad4(w);

        // StringFileInfo
        w.Write((ushort)stringFileInfoLen);
        w.Write((ushort)0);
        w.Write((ushort)1);
        WritePadded(w, "StringFileInfo");
        w.Write(stringTable);
        Pad4(w);

        // VarFileInfo
        w.Write(varInfo);
        Pad4(w);

        return ms.ToArray();
    }

    private static void Add(List<(string, string)> list, string key, string? value)
    {
        if (string.IsNullOrEmpty(value)) return;
        list.Add((key, value));
    }

    private static byte[] BuildFixedFileInfo(string? fileVersion, string? productVersion)
    {
        var (fmaj, fmin, fbuild, frev) = ParseVersion(fileVersion);
        var (pmaj, pmin, pbuild, prev) = ParseVersion(productVersion);

        using var ms = new MemoryStream();
        var w = new BinaryWriter(ms);
        w.Write(0xFEEF_04BDu);   // dwSignature
        w.Write(0x0001_0000u);   // dwStrucVersion
        w.Write((uint)((fmaj << 16) | fmin));
        w.Write((uint)((fbuild << 16) | frev));
        w.Write((uint)((pmaj << 16) | pmin));
        w.Write((uint)((pbuild << 16) | prev));
        w.Write(0x3Fu);          // dwFileFlagsMask
        w.Write(0u);             // dwFileFlags
        w.Write(0x40004u);       // dwFileOS = VOS_NT_WINDOWS32
        w.Write(1u);             // dwFileType = VFT_APP
        w.Write(0u);             // dwFileSubtype
        w.Write(0u);             // dwFileDateMS
        w.Write(0u);             // dwFileDateLS
        return ms.ToArray();
    }

    private static (int, int, int, int) ParseVersion(string? v)
    {
        if (string.IsNullOrEmpty(v)) return (0, 0, 0, 0);
        var parts = v.Split('.');
        return (
            Parse(parts, 0), Parse(parts, 1), Parse(parts, 2), Parse(parts, 3));
        static int Parse(string[] p, int i) => i < p.Length && int.TryParse(p[i], out var n) ? n : 0;
    }

    private static byte[] BuildStringTable(List<(string Key, string Value)> strings)
    {
        using var ms = new MemoryStream();
        var w = new BinaryWriter(ms, Encoding.Unicode);

        // Table header (no value)
        var blocks = strings.Select(s => BuildString(s.Key, s.Value)).ToList();
        int len = 6 + Align4(9 * 2) + blocks.Sum(b => b.Length);
        w.Write((ushort)len);
        w.Write((ushort)0);
        w.Write((ushort)1);
        WritePadded(w, "040904B0");
        foreach (var b in blocks) w.Write(b);
        Pad4(w);
        return ms.ToArray();
    }

    private static byte[] BuildString(string key, string value)
    {
        using var ms = new MemoryStream();
        var w = new BinaryWriter(ms, Encoding.Unicode);
        int valueLen = (value.Length + 1) * 2;
        int len = 6 + Align4((key.Length + 1) * 2) + valueLen;
        w.Write((ushort)len);
        w.Write((ushort)valueLen);
        w.Write((ushort)1);
        WritePadded(w, key);
        w.Write(value.ToCharArray());
        w.Write((ushort)0);
        Pad4(w);
        return ms.ToArray();
    }

    private static byte[] BuildVarFileInfo()
    {
        using var ms = new MemoryStream();
        var w = new BinaryWriter(ms, Encoding.Unicode);

        int varBlockLen = 6 + Align4(12 * 2) + 4; // header + "Translation" key + 1 pair (4 bytes)
        int totalLen = 6 + Align4(12 * 2) + varBlockLen;

        w.Write((ushort)totalLen);
        w.Write((ushort)0);
        w.Write((ushort)1);
        WritePadded(w, "VarFileInfo");

        w.Write((ushort)varBlockLen);
        w.Write((ushort)0);
        w.Write((ushort)1);
        WritePadded(w, "Translation");
        w.Write((ushort)0x0409);  // lang
        w.Write((ushort)0x04B0);  // codepage
        Pad4(w);

        Pad4(w);
        return ms.ToArray();
    }

    private static void WritePadded(BinaryWriter w, string s)
    {
        foreach (var c in s) w.Write((ushort)c);
        w.Write((ushort)0);
        Pad4(w);
    }

    private static void Pad4(BinaryWriter w)
    {
        while (w.BaseStream.Position % 4 != 0) w.Write((byte)0);
    }

    private static int Align4(int n) => (n + 3) & ~3;

    // ── Icon ─────────────────────────────────────────────────────────────

    private static void AddIconResources(List<ResourceEntry> entries, byte[] ico)
    {
        var images = ParseIco(ico);
        if (images.Count == 0) return;

        // RT_ICON entries (one per image)
        var iconIds = new List<int>();
        for (int i = 0; i < images.Count; i++)
        {
            int id = i + 1;
            iconIds.Add(id);
            entries.Add(new ResourceEntry(RtIcon, id, 0x0409_04B0, images[i].Data));
        }

        // RT_GROUP_ICON: GRPICONDIR built from the .ico directory.
        using var ms = new MemoryStream();
        var w = new BinaryWriter(ms);
        w.Write((ushort)0);              // reserved
        w.Write((ushort)1);              // type = icon
        w.Write((ushort)images.Count);
        for (int i = 0; i < images.Count; i++)
        {
            var img = images[i];
            w.Write(img.Width);      // 0 means 256 in ICO format
            w.Write(img.Height);
            w.Write(img.ColorCount);
            w.Write((byte)0);            // reserved
            w.Write((ushort)img.Planes);
            w.Write((ushort)img.BitCount);
            w.Write((uint)img.Data.Length);
            w.Write((ushort)iconIds[i]);
        }
        entries.Add(new ResourceEntry(RtGroupIcon, 1, 0x0409_04B0, ms.ToArray()));
    }

    private static List<(byte Width, byte Height, byte ColorCount, ushort Planes, ushort BitCount, byte[] Data)>
        ParseIco(byte[] ico)
    {
        var result = new List<(byte, byte, byte, ushort, ushort, byte[])>();
        if (ico.Length < 6) return result;

        int count = BitConverter.ToUInt16(ico, 4);
        for (int i = 0; i < count; i++)
        {
            int off = 6 + i * 16;
            if (off + 16 > ico.Length) break;

            byte width = ico[off];
            byte height = ico[off + 1];
            byte colorCount = ico[off + 2];
            ushort planes = BitConverter.ToUInt16(ico, off + 4);
            ushort bitCount = BitConverter.ToUInt16(ico, off + 6);
            int size = checked((int)BitConverter.ToUInt32(ico, off + 8));
            int dataOff = checked((int)BitConverter.ToUInt32(ico, off + 12));
            if (dataOff < 0 || dataOff + size > ico.Length) continue;

            result.Add((width, height, colorCount, planes, bitCount, ico.AsSpan(dataOff, size).ToArray()));
        }
        return result;
    }

    // ── Resource tree serialization ──────────────────────────────────────

    private const int HighBit = unchecked((int)0x8000_0000);

    /// <summary>
    /// Serializes the resource directory tree into a single buffer where all
    /// directory-entry offsets are relative to the root (offset 0). Returns the
    /// data blobs (in order) and the buffer offsets of every data entry's
    /// OffsetToData field (to be patched with absolute RVAs by the caller).
    /// </summary>
    private static (byte[] Tree, List<byte[]> Blobs, List<int> DataPositions)
        SerializeResourceTree(List<ResourceEntry> entries)
    {
        var blobs = new List<byte[]>();
        var dataPositions = new List<int>();
        var dirPatches = new List<(int Pos, int Value)>();

        var ms = new MemoryStream();
        WriteTypeLevel(ms, entries, blobs, dataPositions, dirPatches);

        var buf = ms.ToArray();
        foreach (var (pos, value) in dirPatches)
            BitConverter.TryWriteBytes(buf.AsSpan(pos, 4), (uint)value);

        return (buf, blobs, dataPositions);
    }

    private static void WriteDirHeader(MemoryStream ms, int count)
    {
        var w = new BinaryWriter(ms);
        w.Write(0u); w.Write(0u); w.Write((ushort)0); w.Write((ushort)0);
        w.Write((ushort)0); w.Write((ushort)count);
        w.Flush();
    }

    private static void WriteTypeLevel(
        MemoryStream ms, List<ResourceEntry> entries,
        List<byte[]> blobs, List<int> dataPositions, List<(int, int)> dirPatches)
    {
        var groups = entries.GroupBy(e => e.Type).OrderBy(g => g.Key).ToList();
        WriteDirHeader(ms, groups.Count);

        var patchPositions = new List<int>();
        var w = new BinaryWriter(ms);
        foreach (var g in groups)
        {
            w.Write((uint)g.Key);
            patchPositions.Add((int)ms.Position);
            w.Write(0u);
        }
        w.Flush();

        for (int i = 0; i < groups.Count; i++)
        {
            int childStart = (int)ms.Position;
            dirPatches.Add((patchPositions[i], childStart | HighBit));
            WriteNameLevel(ms, groups[i].ToList(), blobs, dataPositions, dirPatches);
        }
    }

    private static void WriteNameLevel(
        MemoryStream ms, List<ResourceEntry> entries,
        List<byte[]> blobs, List<int> dataPositions, List<(int, int)> dirPatches)
    {
        var groups = entries.GroupBy(e => e.Name).OrderBy(g => g.Key).ToList();
        WriteDirHeader(ms, groups.Count);

        var patchPositions = new List<int>();
        var w = new BinaryWriter(ms);
        foreach (var g in groups)
        {
            w.Write((uint)g.Key);
            patchPositions.Add((int)ms.Position);
            w.Write(0u);
        }
        w.Flush();

        for (int i = 0; i < groups.Count; i++)
        {
            int childStart = (int)ms.Position;
            dirPatches.Add((patchPositions[i], childStart | HighBit));
            WriteLangLevel(ms, groups[i].ToList(), blobs, dataPositions, dirPatches);
        }
    }

    private static void WriteLangLevel(
        MemoryStream ms, List<ResourceEntry> entries,
        List<byte[]> blobs, List<int> dataPositions, List<(int, int)> dirPatches)
    {
        var ordered = entries.OrderBy(e => e.Language).ToList();
        WriteDirHeader(ms, ordered.Count);

        // Entry slots: language id -> data entry offset (no high bit).
        var patchPositions = new List<int>();
        var w = new BinaryWriter(ms);
        foreach (var e in ordered)
        {
            w.Write((uint)e.Language);
            patchPositions.Add((int)ms.Position);
            w.Write(0u);
        }
        w.Flush();

        // Data entries — record their global positions.
        var dataEntryStarts = new List<int>();
        foreach (var e in ordered)
        {
            dataEntryStarts.Add((int)ms.Position);
            dataPositions.Add((int)ms.Position); // OffsetToData field position
            var dw = new BinaryWriter(ms);
            dw.Write(0u);                 // RVA, patched by caller
            dw.Write((uint)e.Data.Length);
            dw.Write(0u);
            dw.Write(0u);
            dw.Flush();
            blobs.Add(e.Data);
        }

        // Patch entry offsets to point at their data entries.
        for (int i = 0; i < ordered.Count; i++)
            dirPatches.Add((patchPositions[i], dataEntryStarts[i]));
    }
}
