using System.Runtime.InteropServices;
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
        var systemItems = new List<string>();
        var userItems = new List<string>();

        try
        {
            using var sysKey = Registry.LocalMachine.OpenSubKey(
                @"SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
            if (sysKey != null)
            {
                foreach (var name in sysKey.GetValueNames())
                {
                    var val = sysKey.GetValue(name, "")?.ToString() ?? "";
                    systemItems.Add($$"""{"name":"{{Esc(name)}}","value":"{{Esc(val)}}"}""");
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
                    userItems.Add($$"""{"name":"{{Esc(name)}}","value":"{{Esc(val)}}"}""");
                }
            }
        }
        catch { }

        return $$"""{"system":[{{string.Join(",", systemItems)}}],"user":[{{string.Join(",", userItems)}}]}""";
    }

    private static string CollectLinux()
    {
        var items = new List<string>();
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            var name = entry.Key?.ToString() ?? "";
            var value = entry.Value?.ToString() ?? "";
            items.Add($$"""{"name":"{{Esc(name)}}","value":"{{Esc(value)}}"}""");
        }
        return $$"""{"system":[{{string.Join(",", items)}}],"user":[]}""";
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
