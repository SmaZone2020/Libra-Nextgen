using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32;

namespace LibraNextgen.Agent.Modules.Recon;

public static class EnvInfo
{
    public static string Collect()
    {
        if (OperatingSystem.IsWindows())
        {
            return CollectWindows();
        }
        return CollectLinux();
    }

    public static bool Set(string name, string value, string scope)
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                var target = scope == "system"
                    ? EnvironmentVariableTarget.Machine
                    : EnvironmentVariableTarget.User;
                Environment.SetEnvironmentVariable(name, value, target);
                return true;
            }
            else
            {
                Environment.SetEnvironmentVariable(name, value);
                return true;
            }
        }
        catch { return false; }
    }

    public static bool Delete(string name, string scope)
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                var target = scope == "system"
                    ? EnvironmentVariableTarget.Machine
                    : EnvironmentVariableTarget.User;
                Environment.SetEnvironmentVariable(name, null, target);
                return true;
            }
            else
            {
                Environment.SetEnvironmentVariable(name, null);
                return true;
            }
        }
        catch { return false; }
    }

    private static string CollectWindows()
    {
        var system = new List<object>();
        var user = new List<object>();

        try
        {
            using var sysKey = Registry.LocalMachine.OpenSubKey(
                @"SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
            if (sysKey != null)
            {
                foreach (var name in sysKey.GetValueNames())
                {
                    var val = sysKey.GetValue(name, "")?.ToString() ?? "";
                    system.Add(new { name, value = val });
                }
            }
        }
        catch { }

        try
        {
            using var userKey = Registry.CurrentUser.OpenSubKey(@"Environment");
            if (userKey != null)
            {
                foreach (var name in userKey.GetValueNames())
                {
                    var val = userKey.GetValue(name, "")?.ToString() ?? "";
                    user.Add(new { name, value = val });
                }
            }
        }
        catch { }

        return JsonSerializer.Serialize(new { system, user });
    }

    private static string CollectLinux()
    {
        var vars = new List<object>();
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            vars.Add(new { name = entry.Key?.ToString() ?? "", value = entry.Value?.ToString() ?? "" });
        }
        return JsonSerializer.Serialize(new { system = vars, user = Array.Empty<object>() });
    }
}
