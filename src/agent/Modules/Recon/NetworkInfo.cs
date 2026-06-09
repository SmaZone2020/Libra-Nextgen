using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace LibraNextgen.Agent.Modules.Recon;

public static class NetworkInfo
{
    public static string Collect()
    {
        var interfaces = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up)
            .Select(n =>
            {
                var ips = n.GetIPProperties().UnicastAddresses
                    .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork ||
                                a.Address.AddressFamily == AddressFamily.InterNetworkV6)
                    .Select(a => $"\"{a.Address}\"");
                return $$"""
                    {"name":"{{Escape(n.Name)}}",
                    "type":"{{n.NetworkInterfaceType}}",
                    "mac":"{{n.GetPhysicalAddress()}}",
                    "speed":{{n.Speed}},
                    "ipAddresses":[{{string.Join(",", ips)}}]}
                    """.Replace("\n", "").Replace("\r", "");
            });

        var dns = IPGlobalProperties.GetIPGlobalProperties().DomainName;
        return $$"""
            {"interfaces":[{{string.Join(",", interfaces)}}],
            "dnsSuffix":"{{Escape(dns)}}"}
            """.Replace("\n", "").Replace("\r", "");
    }

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
