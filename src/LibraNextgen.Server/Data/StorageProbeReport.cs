using System.Text.Json;

namespace LibraNextgen.Service.Data;

/// <summary>
/// One-line JSON verdict for the desktop shell's connection-string pre-flight
/// (<c>LIBRA_STORAGE_PROBE=1</c>). Kept pure and side-effect free so the wire
/// contract the shell parses is unit-testable without spawning a process or
/// calling <c>Environment.Exit</c>.
/// </summary>
public static class StorageProbeReport
{
    /// <summary>Service reads this before binding anything; exactly "1" enables the probe.</summary>
    public const string EnvVarName = "LIBRA_STORAGE_PROBE";

    /// <summary>Exit codes the shell switches on.</summary>
    public const int ReachableExitCode = 0;
    public const int UnreachableExitCode = 4;

    public static bool IsProbeRequested()
        => Environment.GetEnvironmentVariable(EnvVarName) == "1";

    /// <summary>
    /// Field names and order are the contract the shell parses, so they are
    /// spelled out here rather than derived from the model.
    /// </summary>
    public static string Render(StoreResolution resolution)
    {
        var reachable = !resolution.ExitRequested;
        return JsonSerializer.Serialize(new
        {
            reachable,
            requested = resolution.Requested.ToString().ToLowerInvariant(),
            effective = resolution.Effective.ToString().ToLowerInvariant(),
            error = reachable ? null : Reason(resolution),
        });
    }

    /// <summary>A bare "false" leaves the user nothing to fix, so a failed
    /// resolution always carries some reason.</summary>
    public static string Reason(StoreResolution resolution)
        => resolution.Error ?? resolution.FallbackReason ?? "store resolution failed";

    public static int ExitCode(StoreResolution resolution)
        => resolution.ExitRequested ? UnreachableExitCode : ReachableExitCode;
}
