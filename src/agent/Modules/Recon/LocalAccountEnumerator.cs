using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LibraNextgen.Agent.Modules.Recon;

public static class LocalAccountEnumerator
{
    /// <summary>
    /// Enumerate all local user accounts and their group memberships
    /// using PowerShell's Get-LocalUser / Get-LocalGroupMember cmdlets.
    /// </summary>
    public static async Task<string> EnumerateAsync(CancellationToken ct = default)
    {
        try
        {
            // 1. Get all local users via Get-LocalUser
            var usersJson = await RunPowerShellAsync("Get-LocalUser | Select Name, Enabled | ConvertTo-Json", ct);
            var users = ParseUsers(usersJson);

            // 2. Get Administrators group members
            var admins = await GetAdministratorsAsync(ct);

            // 3. Build output JSON
            var sb = new StringBuilder();
            sb.Append("{\"accounts\":[");
            for (int i = 0; i < users.Count; i++)
            {
                if (i > 0) sb.Append(',');
                var u = users[i];
                var isAdmin = admins.Contains(u.name, StringComparer.OrdinalIgnoreCase);
                var groups = new List<string>();
                if (isAdmin) groups.Add("Administrators");

                sb.Append('{');
                sb.Append($"\"name\":{JsonEscape(u.name)}");
                sb.Append($",\"isAdmin\":{(isAdmin ? "true" : "false")}");
                sb.Append(",\"groups\":[");
                for (int j = 0; j < groups.Count; j++)
                {
                    if (j > 0) sb.Append(',');
                    sb.Append(JsonEscape(groups[j]));
                }
                sb.Append(']');
                sb.Append('}');
            }
            sb.Append("]}");
            return sb.ToString();
        }
        catch (Exception ex)
        {
            return $"{{\"error\":{JsonEscape(ex.Message)},\"accounts\":[]}}";
        }
    }

    private static List<(string name, bool enabled)> ParseUsers(string json)
    {
        var result = new List<(string name, bool enabled)>();
        if (string.IsNullOrWhiteSpace(json)) return result;

        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            // Handle single-object case (PowerShell returns object when 1 user)
            var elements = root.ValueKind == JsonValueKind.Array
                ? root.EnumerateArray()
                : new[] { root }.AsEnumerable();

            foreach (var el in elements)
            {
                var name = el.TryGetProperty("Name", out var n) ? n.GetString() ?? "" : "";
                var enabled = el.TryGetProperty("Enabled", out var e) && e.GetBoolean();
                if (!string.IsNullOrWhiteSpace(name))
                    result.Add((name, enabled));
            }
        }
        catch
        {
            // Fallback: if JSON parsing fails, try to extract names manually
            foreach (Match m in System.Text.RegularExpressions.Regex.Matches(json, @"""Name""\s*:\s*""([^""]+)"""))
            {
                var name = m.Groups[1].Value;
                if (!string.IsNullOrWhiteSpace(name))
                    result.Add((name, true));
            }
        }
        return result;
    }

    private static async Task<HashSet<string>> GetAdministratorsAsync(CancellationToken ct)
    {
        var members = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var json = await RunPowerShellAsync(
                "Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | Select Name | ConvertTo-Json",
                ct);

            if (string.IsNullOrWhiteSpace(json)) return members;

            using var doc = JsonDocument.Parse(json);
            var elements = doc.RootElement.ValueKind == JsonValueKind.Array
                ? doc.RootElement.EnumerateArray()
                : new[] { doc.RootElement }.AsEnumerable();

            foreach (var el in elements)
            {
                var rawName = el.TryGetProperty("Name", out var n) ? n.GetString() ?? "" : "";
                // Strip DOMAIN\ or COMPUTER\ prefix
                var bsIdx = rawName.LastIndexOf('\\');
                var name = bsIdx >= 0 ? rawName.Substring(bsIdx + 1) : rawName;
                if (!string.IsNullOrWhiteSpace(name))
                    members.Add(name);
            }
        }
        catch
        {
            // Group doesn't exist or no members — fine
        }
        return members;
    }

    private static async Task<string> RunPowerShellAsync(string command, CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -Command \"{command}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
        };

        using var process = Process.Start(psi);
        if (process == null) return string.Empty;

        var output = await process.StandardOutput.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);
        return output.Trim();
    }

    private static string JsonEscape(string s)
    {
        var sb = new StringBuilder();
        sb.Append('"');
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default: sb.Append(c); break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }
}
