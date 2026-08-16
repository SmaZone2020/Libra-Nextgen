using System.Text;

namespace LibraNextgen.Common.Pe;

public sealed record ResourceEntry(int Type, int Name, int Language, byte[] Data);

/// <summary>
/// Reads a Windows PE and appends a new resource section. Pure managed code —
/// no native Windows API, so it works on any host OS.
/// </summary>
internal sealed class PeReader
{
    private readonly byte[] _pe;
    private readonly int _eLfanew;
    private readonly int _numberOfSections;
    private readonly int _sizeOfOptionalHeader;
    private readonly int _optHeaderOffset;
    private readonly bool _isPe32Plus;
    private readonly int _sectionAlignment;
    private readonly int _fileAlignment;
    private readonly int _numberOfRvaAndSizes;
    private readonly int _dataDirectoryOffset;
    private readonly int _sectionTableOffset;
    private int _resourceRootRva;

    private sealed record Section(string Name, int VirtualSize, int VirtualAddress, int SizeOfRawData, int PointerToRawData);

    public PeReader(byte[] pe)
    {
        _pe = pe;
        _eLfanew = ReadI32(0x3C);
        if (_eLfanew < 0 || _eLfanew + 4 + 20 > pe.Length)
            throw new InvalidDataException("Not a valid PE file.");

        _numberOfSections = ReadU16(_eLfanew + 4 + 2);
        _sizeOfOptionalHeader = ReadU16(_eLfanew + 4 + 16);
        _optHeaderOffset = _eLfanew + 4 + 20;

        var magic = ReadU16(_optHeaderOffset);
        _isPe32Plus = magic == 0x20B;

        _sectionAlignment = ReadI32(_optHeaderOffset + 32);
        _fileAlignment = ReadI32(_optHeaderOffset + 36);

        _numberOfRvaAndSizes = ReadI32(_optHeaderOffset + (_isPe32Plus ? 108 : 92));
        _dataDirectoryOffset = _optHeaderOffset + (_isPe32Plus ? 112 : 96);
        _sectionTableOffset = _optHeaderOffset + _sizeOfOptionalHeader;
    }

    // ── Public API ───────────────────────────────────────────────────────

    public List<ResourceEntry> ReadResources()
    {
        var result = new List<ResourceEntry>();
        if (_numberOfRvaAndSizes <= 2) return result;

        int rva = ReadI32(_dataDirectoryOffset + 2 * 8);
        int size = ReadI32(_dataDirectoryOffset + 2 * 8 + 4);
        if (rva == 0 || size == 0) return result;

        var rootOffset = RvaToOffset(rva);
        if (rootOffset < 0) return result;

        _resourceRootRva = rva;
        ParseDirectory(rootOffset, -1, -1, result);
        return result;
    }

    public byte[] Rebuild(byte[] tree, List<byte[]> blobs, List<int> dataPositions)
    {
        // Layout the section content: tree (4-aligned) then blobs (4-aligned).
        int dataStart = Align(tree.Length, 4);
        var blobOffsets = new int[blobs.Count];
        int cursor = dataStart;
        for (int i = 0; i < blobs.Count; i++)
        {
            blobOffsets[i] = cursor;
            cursor += Align(blobs[i].Length, 4);
        }
        int contentSize = cursor;

        // New section virtual address (aligned to section alignment).
        int sizeOfImage = ReadI32(_optHeaderOffset + 56);
        int sectionVA = Align(sizeOfImage, _sectionAlignment);
        int virtualSize = Align(contentSize, _sectionAlignment);
        int sectionRawSize = Align(contentSize, _fileAlignment);

        // Patch data entry RVAs (absolute) into the tree buffer.
        for (int i = 0; i < dataPositions.Count && i < blobs.Count; i++)
        {
            BitConverter.TryWriteBytes(tree.AsSpan(dataPositions[i], 4), (uint)(sectionVA + blobOffsets[i]));
        }

        // Read the existing section headers + raw data.
        var sectionData = new List<byte[]>();
        for (int i = 0; i < _numberOfSections; i++)
        {
            int hdr = _sectionTableOffset + i * 40;
            int rawPtr = ReadI32(hdr + 20);
            int rawSize = ReadI32(hdr + 16);
            var data = new byte[rawSize];
            if (rawPtr >= 0 && rawSize >= 0 && rawPtr + rawSize <= _pe.Length)
                Array.Copy(_pe, rawPtr, data, 0, rawSize);
            sectionData.Add(data);
        }

        // Relayout the whole file so we can insert an extra section header even
        // when there is no padding in the section table.
        int tableSize = (_numberOfSections + 1) * 40;
        int fileDataStart = Align(_sectionTableOffset + tableSize, _fileAlignment);

        var sectionOffsets = new int[_numberOfSections];
        int fileCursor = fileDataStart;
        for (int i = 0; i < _numberOfSections; i++)
        {
            sectionOffsets[i] = fileCursor;
            fileCursor += Align(sectionData[i].Length, _fileAlignment);
        }
        int newSectionOffset = fileCursor;

        using var ms = new MemoryStream();
        // Headers up to the section table.
        ms.Write(_pe, 0, _sectionTableOffset);
        // Original section headers with updated raw offsets.
        for (int i = 0; i < _numberOfSections; i++)
        {
            var hdr = new byte[40];
            Array.Copy(_pe, _sectionTableOffset + i * 40, hdr, 0, 40);
            WriteI32(hdr, 20, sectionOffsets[i]);
            ms.Write(hdr);
        }
        // New section header.
        ms.Write(BuildSectionHeader(sectionVA, virtualSize, sectionRawSize, newSectionOffset));

        // Pad to the first section data offset.
        while (ms.Length < fileDataStart) ms.WriteByte(0);

        // Original section data (kept in order).
        for (int i = 0; i < _numberOfSections; i++)
        {
            ms.Write(sectionData[i]);
            int target = (i + 1 < _numberOfSections) ? sectionOffsets[i + 1] : newSectionOffset;
            while (ms.Length < target) ms.WriteByte(0);
        }

        // New section data.
        ms.Write(tree);
        while (ms.Length < newSectionOffset + Align(tree.Length, 4)) ms.WriteByte(0);
        foreach (var b in blobs)
        {
            ms.Write(b);
            while ((ms.Length - newSectionOffset) % 4 != 0) ms.WriteByte(0);
        }
        while (ms.Length < newSectionOffset + sectionRawSize) ms.WriteByte(0);

        var result = ms.ToArray();

        // Patch the headers in the output buffer.
        WriteU16(result, _eLfanew + 4 + 2, (ushort)(_numberOfSections + 1));
        WriteI32(result, _optHeaderOffset + 56, sectionVA + virtualSize);
        WriteI32(result, _dataDirectoryOffset + 2 * 8, sectionVA);
        WriteI32(result, _dataDirectoryOffset + 2 * 8 + 4, virtualSize);

        return result;
    }

    // ── Resource parsing ─────────────────────────────────────────────────

    private void ParseDirectory(
        int offset, int type, int name, List<ResourceEntry> result)
    {
        int named = ReadU16(offset + 12);
        int ids = ReadU16(offset + 14);
        int count = named + ids;
        if (count < 0 || count > 10000) return;

        int entriesOffset = offset + 16;
        for (int i = 0; i < count; i++)
        {
            int e = entriesOffset + i * 8;
            int id = ReadI32(e);
            int val = ReadI32(e + 4);
            bool isSub = (val & unchecked((int)0x8000_0000)) != 0;
            int childOffset = val & 0x7FFF_FFFF;

            // If the entry name has the high bit set, it's a string name; we only
            // support integer IDs here (all our resources use integer IDs).
            int childAbs = _resourceRootRva + childOffset;
            int childFileOffset = RvaToOffset(childAbs);

            if (isSub)
            {
                if (childFileOffset < 0) continue;
                if (type == -1)
                    ParseDirectory(childFileOffset, id, name, result);
                else if (name == -1)
                    ParseDirectory(childFileOffset, type, id, result);
                else
                    ParseDirectory(childFileOffset, type, name, result);
            }
            else
            {
                if (childFileOffset < 0) continue;
                int dataRva = ReadI32(childFileOffset);
                int dataSize = ReadI32(childFileOffset + 4);
                int dataOffset = RvaToOffset(dataRva);
                if (dataOffset < 0 || dataOffset + dataSize > _pe.Length) continue;
                var blob = new byte[dataSize];
                Array.Copy(_pe, dataOffset, blob, 0, dataSize);
                result.Add(new ResourceEntry(type, name, id, blob));
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private int RvaToOffset(int rva)
    {
        for (int i = 0; i < _numberOfSections; i++)
        {
            int baseOffset = _sectionTableOffset + i * 40;
            int va = ReadI32(baseOffset + 12);
            int vs = ReadI32(baseOffset + 8);
            int rawSize = ReadI32(baseOffset + 16);
            int rawPtr = ReadI32(baseOffset + 20);
            int span = Math.Max(vs, rawSize);
            if (rva >= va && rva < va + span)
                return rawPtr + (rva - va);
        }
        return -1;
    }

    private byte[] BuildSectionHeader(int va, int vs, int rawSize, int rawPtr)
    {
        var h = new byte[40];
        Encoding.ASCII.GetBytes(".rsrc").CopyTo(h, 0);
        WriteI32(h, 8, vs);
        WriteI32(h, 12, va);
        WriteI32(h, 16, rawSize);
        WriteI32(h, 20, rawPtr);
        WriteU32(h, 36, 0x4000_0040u); // MEM_READ | CNT_INITIALIZED_DATA
        return h;
    }

    private int ReadI32(int offset) => BitConverter.ToInt32(_pe, offset);
    private ushort ReadU16(int offset) => BitConverter.ToUInt16(_pe, offset);
    private static int ReadI32(byte[] b, int offset) => BitConverter.ToInt32(b, offset);
    private static ushort ReadU16(byte[] b, int offset) => BitConverter.ToUInt16(b, offset);
    private static void WriteU16(byte[] b, int offset, ushort v) => BitConverter.TryWriteBytes(b.AsSpan(offset, 2), v);
    private static void WriteI32(byte[] b, int offset, int v) => BitConverter.TryWriteBytes(b.AsSpan(offset, 4), v);
    private static void WriteU32(byte[] b, int offset, uint v) => BitConverter.TryWriteBytes(b.AsSpan(offset, 4), v);
    private static int Align(int value, int alignment) => (value + alignment - 1) / alignment * alignment;
}
