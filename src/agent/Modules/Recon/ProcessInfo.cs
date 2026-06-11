using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace LibraNextgen.Agent.Modules.Recon;

public static class ProcessInfo
{
    public static string Collect(string? lastHash)
    {
        var procs = Process.GetProcesses();
        Array.Sort(procs, (a, b) => a.Id.CompareTo(b.Id));

        var hashInput = new StringBuilder();
        var items = new List<string>(procs.Length);

        foreach (var p in procs)
        {
            try
            {
                hashInput.Append(p.Id).Append(':').Append(p.ProcessName).Append(';');

                string startTime = "";
                try { startTime = p.StartTime.ToUniversalTime().ToString("o"); } catch { }

                long cpuMs = 0;
                try { cpuMs = (long)p.TotalProcessorTime.TotalMilliseconds; } catch { }

                long memBytes = 0;
                try { memBytes = p.WorkingSet64; } catch { }

                items.Add($$"""{"pid":{{p.Id}},"name":"{{Esc(p.ProcessName)}}","startTime":"{{Esc(startTime)}}","cpuMs":{{cpuMs}},"memoryBytes":{{memBytes}},"threadCount":{{p.Threads.Count}}}""");
            }
            catch { }
        }

        var hash = ComputeHash(hashInput.ToString());

        if (lastHash != null && hash == lastHash)
        {
            return """{"changed":false}""";
        }

        return $$"""{"changed":true,"hash":"{{Esc(hash)}}","processes":[{{string.Join(",", items)}}]}""";
    }

    public static bool Kill(int pid)
    {
        try
        {
            var proc = Process.GetProcessById(pid);
            proc.Kill(true);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string ComputeHash(string input)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexStringLower(bytes);
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
