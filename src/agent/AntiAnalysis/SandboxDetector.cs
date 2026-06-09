namespace LibraNextgen.Agent.AntiAnalysis;

public static class SandboxDetector
{
    public static bool IsSandbox()
    {
        return CheckCpuCores() || CheckMemory() || CheckUptime();
    }

    private static bool CheckCpuCores()
    {
        var cores = Environment.ProcessorCount;
        return cores < 2;
    }

    private static bool CheckMemory()
    {
        var totalMemoryMb = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes / (1024 * 1024);
        return totalMemoryMb < 2048;
    }

    private static bool CheckUptime()
    {
        var uptime = Environment.TickCount64 / 1000;
        return uptime < 300; // Less than 5 minutes
    }
}
