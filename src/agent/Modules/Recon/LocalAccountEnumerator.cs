using LibraNextgen.Agent.Modules.Execution;

namespace LibraNextgen.Agent.Modules.Recon;

public static class LocalAccountEnumerator
{
    /// <summary>
    /// Enumerate all local user accounts and check Administrators group membership.
    /// Uses the in-memory PowerShell Runspace (no powershell.exe process spawn).
    /// </summary>
    public static async Task<string> EnumerateAsync(CancellationToken ct = default)
    {
        try
        {
            const string script = """
                $admins = @{}
                Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | ForEach-Object {
                    $n = $_.Name -replace '^.*\\', ''
                    $admins[$n] = $true
                }
                Get-LocalUser | ForEach-Object {
                    $isAdmin = [bool]$admins[$_.Name]
                    $grps = if ($isAdmin) { @('Administrators') } else { @() }
                    $_ | Add-Member -NotePropertyName 'isAdmin' -NotePropertyValue $isAdmin -Force
                    $_ | Add-Member -NotePropertyName 'sidValue' -NotePropertyValue $_.SID.Value -Force
                    $_ | Add-Member -NotePropertyName 'groups' -NotePropertyValue $grps -Force
                    $_
                } | Select-Object Name, FullName, Description, Enabled, isAdmin, sidValue, groups,
                    PasswordRequired, UserMayChangePassword, LastLogon, AccountExpires,
                    PasswordLastSet, PasswordExpires, ObjectClass, PrincipalSource |
                ConvertTo-Json -Compress
                """;

            var output = await PowerShellRunner.ExecuteAsync(script, ct);

            // Trim any leading/trailing non-JSON text
            var json = output?.Trim();
            if (string.IsNullOrEmpty(json))
                return "{\"accounts\":[]}";

            // Find the JSON (skip any warning/error prefix lines)
            var start = json!.IndexOf('[');
            var end = json.LastIndexOf(']');
            if (start >= 0 && end > start)
            {
                json = json[start..(end + 1)];
                return $"{{\"accounts\":{json}}}";
            }

            return "{\"accounts\":[]}";
        }
        catch (Exception ex)
        {
            return $"{{\"error\":\"{ex.Message.Replace("\"", "\\\"")}\",\"accounts\":[]}}";
        }
    }
}
