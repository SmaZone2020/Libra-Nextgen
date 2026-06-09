using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;

namespace LibraNextgen.Agent.Modules.Recon;

public static class NetworkInfo
{
    public static string Collect()
    {
        var interfaces = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up)
            .Select(n => new
            {
                name = n.Name,
                type = n.NetworkInterfaceType.ToString(),
                mac = n.GetPhysicalAddress().ToString(),
                speed = n.Speed,
                ipAddresses = n.GetIPProperties().UnicastAddresses
                    .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork ||
                                a.Address.AddressFamily == AddressFamily.InterNetworkV6)
                    .Select(a => a.Address.ToString())
                    .ToArray()
            }).ToArray();

        var info = new
        {
            interfaces,
            dnsSuffix = IPGlobalProperties.GetIPGlobalProperties().DomainName
        };

        return JsonSerializer.Serialize(info);
    }
}
