using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace LibraNextgen.Agent.Modules.Recon;

public static class LanScan
{
    private const int PING_TIMEOUT_MS = 500;
    private const int MAX_CONCURRENT_PINGS = 60;
    private const int MAX_HOSTS_PER_SUBNET = 256;

    public static async Task<string> ScanAsync()
    {
        var devices = new Dictionary<string, LanDeviceEntry>();

        // 1. Collect local subnets from active interfaces
        var subnets = GetLocalSubnets();

        // 2. Parse ARP table (instant, shows devices host has talked to)
        var arpEntries = await GetArpEntriesAsync();
        foreach (var e in arpEntries)
            devices.TryAdd(e.IP, e);

        // 3. Ping sweep each /24 subnet
        var sem = new SemaphoreSlim(MAX_CONCURRENT_PINGS);
        var pingTasks = new List<Task>();
        foreach (var (net, mask, localIp) in subnets)
        {
            var hostCount = CountHosts(mask);
            if (hostCount > MAX_HOSTS_PER_SUBNET) continue;

            var (start, end) = GetIPRange(net, mask);
            for (uint ip = start; ip <= end; ip++)
            {
                var ipStr = UintToIPStr(ip);
                if (ipStr == localIp) continue;
                if (devices.ContainsKey(ipStr)) continue;

                pingTasks.Add(PingOneAsync(ipStr, devices, sem));
            }
        }

        if (pingTasks.Count > 0)
            await Task.WhenAll(pingTasks);

        // 4. Try resolve hostnames for up to 30 devices (reverse DNS is slow)
        int resolveCount = 0;
        foreach (var entry in devices.Values)
        {
            if (resolveCount >= 30) break;
            if (entry.Hostname.Length > 0) continue;
            try
            {
                var hostEntry = await Dns.GetHostEntryAsync(entry.IP).WaitAsync(TimeSpan.FromMilliseconds(300));
                if (hostEntry.HostName != entry.IP)
                {
                    entry.Hostname = hostEntry.HostName;
                    resolveCount++;
                }
            }
            catch { /* ignore */ }
        }

        // 5. Build JSON
        return BuildJson(devices, subnets);
    }

    private static List<(string Network, string Mask, string LocalIp)> GetLocalSubnets()
    {
        var result = new List<(string, string, string)>();
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up) continue;
            foreach (var addr in nic.GetIPProperties().UnicastAddresses)
            {
                if (addr.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                var ip = addr.Address.ToString();
                var mask = addr.IPv4Mask?.ToString() ?? "255.255.255.0";
                result.Add((ip, mask, ip));
            }
        }
        return result;
    }

    private static async Task<List<LanDeviceEntry>> GetArpEntriesAsync()
    {
        var entries = new List<LanDeviceEntry>();
        try
        {
            using var proc = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "arp",
                    Arguments = "-a",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            proc.Start();
            var output = await proc.StandardOutput.ReadToEndAsync();
            await proc.WaitForExitAsync();

            var ipRe = new Regex(@"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}");
            var macRe = new Regex(@"([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}");
            var hostRe = new Regex(@"^(\S+)\s+\(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\)");

            foreach (var line in output.Split('\n'))
            {
                var ipM = ipRe.Match(line);
                var macM = macRe.Match(line);
                if (!ipM.Success || !macM.Success) continue;

                var ip = ipM.Value;
                var mac = macM.Value.ToUpperInvariant();

                // Check for hostname (Linux arp format)
                var hostname = "";
                var hostM = hostRe.Match(line.TrimStart());
                if (hostM.Success && hostM.Groups[1].Value != "?")
                    hostname = hostM.Groups[1].Value;

                if (ip == "0.0.0.0" || ip.StartsWith("224.") || ip.StartsWith("239.") ||
                    mac == "00-00-00-00-00-00" || mac == "FF-FF-FF-FF-FF-FF")
                    continue;

                entries.Add(new LanDeviceEntry(ip, mac, hostname, "arp"));
            }
        }
        catch { /* arp command unavailable */ }
        return entries;
    }

    private static async Task PingOneAsync(string ip, Dictionary<string, LanDeviceEntry> devices, SemaphoreSlim sem)
    {
        await sem.WaitAsync();
        try
        {
            using var ping = new Ping();
            var reply = await ping.SendPingAsync(ip, PING_TIMEOUT_MS);
            if (reply.Status == IPStatus.Success)
            {
                lock (devices)
                    devices.TryAdd(ip, new LanDeviceEntry(ip, "", "", "ping"));
            }
        }
        catch { /* ignore */ }
        finally { sem.Release(); }
    }

    private static uint IPStrToUint(string ip)
    {
        var parts = ip.Split('.');
        return (uint)(int.Parse(parts[0]) << 24 | int.Parse(parts[1]) << 16 |
                       int.Parse(parts[2]) << 8 | int.Parse(parts[3]));
    }

    private static string UintToIPStr(uint val)
    {
        return $"{(val >> 24) & 0xFF}.{(val >> 16) & 0xFF}.{(val >> 8) & 0xFF}.{val & 0xFF}";
    }

    private static int CountHosts(string mask) =>
        (int)(~IPStrToUint(mask) & 0xFFFFFFFF) - 1;

    private static (uint Start, uint End) GetIPRange(string network, string mask)
    {
        var netVal = IPStrToUint(network);
        var maskVal = IPStrToUint(mask);
        var broadcast = netVal | (~maskVal & 0xFFFFFFFF);
        return (netVal + 1, broadcast - 1);
    }

    private static string BuildJson(Dictionary<string, LanDeviceEntry> devices,
                                     List<(string Network, string Mask, string LocalIp)> subnets)
    {
        var sb = new StringBuilder();
        sb.Append("{\"devices\":[");
        var first = true;
        foreach (var d in devices.Values.OrderBy(e => IPStrToUint(e.IP)))
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"ip\":\""); sb.Append(Esc(d.IP));
            sb.Append("\",\"mac\":\""); sb.Append(Esc(d.MAC));
            sb.Append("\",\"hostname\":\""); sb.Append(Esc(d.Hostname));
            sb.Append("\",\"source\":\""); sb.Append(Esc(d.Source));
            sb.Append("\"}");
        }
        sb.Append("],\"subnets\":[");
        first = true;
        foreach (var (net, mask, _) in subnets)
        {
            if (!first) sb.Append(',');
            first = false;
            var prefix = CountBits(mask);
            sb.Append('"'); sb.Append(Esc($"{net}/{prefix}")); sb.Append('"');
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private static int CountBits(string mask) =>
        Convert.ToString((int)IPStrToUint(mask), 2).Count(c => c == '1');

    private static string Esc(string s) =>
        s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private sealed class LanDeviceEntry
    {
        public string IP { get; }
        public string MAC { get; set; }
        public string Hostname { get; set; }
        public string Source { get; }
        public LanDeviceEntry(string ip, string mac, string hostname, string source)
        {
            IP = ip;
            MAC = mac;
            Hostname = hostname;
            Source = source;
        }
    }
}
