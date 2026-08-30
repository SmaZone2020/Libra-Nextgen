using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

/// <summary>
/// AI 事件通知器：Agent 上线/下线等系统事件触发时，读取 AiEventSubscription 订阅，
/// 以"系统视角"向 Justitia 注入事件信息，由 AI 生成提醒并送达目标：
/// - session 目标：把事件作为用户消息写入控制台会话，AI 回复落库并广播 ai.notify 到控制台；
/// - channel 目标：把事件写入频道会话，AI 回复经频道适配器发送给该频道最近活跃的绑定用户。
/// 事件触发的 AI 运行固定 Cognitio 档位（只读工具，无需审批），并带超时兜底，
/// 防止工具审批挂起导致通知任务永久悬停。
/// </summary>
public class AiEventNotifier
{
    public const string EvtAgentOnline = "agent.online";
    public const string EvtAgentOffline = "agent.offline";

    private static readonly TimeSpan RunTimeout = TimeSpan.FromSeconds(90);

    private readonly MongoDbContext _db;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AiEventNotifier> _logger;

    public AiEventNotifier(MongoDbContext db, IServiceScopeFactory scopeFactory, ILogger<AiEventNotifier> logger)
    {
        _db = db;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    private IMongoCollection<AiEventSubscription> Subs =>
        _db.GetCollection<AiEventSubscription>("ai_event_subscriptions");

    /// <summary>订阅事件触发入口（Agent 上线/下线时由宿主调用，fire-and-forget）。</summary>
    public Task NotifyAsync(string agentId, string hostname, string ipAddress, string eventType, CancellationToken ct = default)
        => Task.Run(async () =>
        {
            try
            {
                var subs = await Subs.Find(x => x.Events.Contains(eventType)).ToListAsync(ct);
                if (subs.Count == 0) return;
                foreach (var sub in subs)
                {
                    try { await NotifyOneAsync(sub, agentId, hostname, ipAddress, eventType, ct); }
                    catch (Exception ex) { _logger.LogWarning(ex, "AI event notify failed (sub {Sub})", sub.Id); }
                }
            }
            catch (Exception ex) { _logger.LogWarning(ex, "AI event notify scan failed ({Event})", eventType); }
        }, ct);

    private async Task NotifyOneAsync(AiEventSubscription sub, string agentId, string hostname, string ipAddress, string eventType, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var ai = scope.ServiceProvider.GetRequiredService<AiService>();
        var channels = scope.ServiceProvider.GetRequiredService<AiChannelService>();
        var ws = scope.ServiceProvider.GetRequiredService<ConnectionManager>();

        var message = eventType == EvtAgentOnline
            ? $"Agent「{hostname}」（{ipAddress}）已上线"
            : $"Agent「{hostname}」（{ipAddress}）已离线（心跳超时）";
        // 以 JSON（type=system_event）注入：前端检测到该结构时渲染为系统事件卡片，
        // 而不是普通用户消息；AI 仍能读到事件内容并生成提醒。
        var prompt = JsonSerializer.Serialize(new
        {
            type = "system_event",
            @event = eventType,
            agentId,
            hostname,
            ip = ipAddress,
            message,
            instruction = "这是系统事件，不是用户消息。请以一句简短提醒告知用户，不要调用工具。",
        });

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(RunTimeout);

        if (sub.TargetType == "session")
        {
            var session = await ai.GetSessionAsync(sub.TargetId, sub.TargetUserId ?? "", cts.Token);
            if (session == null) return;

            var text = new StringBuilder();
            await ai.RunChatAsync(session, prompt, async payload =>
            {
                try
                {
                    var evt = JsonNode.Parse(payload) as JsonObject;
                    if (evt?["type"]?.GetValue<string>() == "message")
                        text.Append(evt["delta"]?.GetValue<string>() ?? "");
                }
                catch { /* 忽略单帧解析失败 */ }
            }, cts.Token, JustitiaTier.Cognitio);

            var reply = text.ToString().Trim();
            if (reply.Length == 0) return;
            await ws.BroadcastToConsoleAsync(new WebSocketMessage
            {
                Type = "ai.notify",
                Channel = "console",
                Data = JsonSerializer.SerializeToElement(new
                {
                    sessionId = session.Id,
                    eventType,
                    agentId,
                    text = reply,
                }),
            }, cts.Token);
            return;
        }

        // channel 目标：通知该频道最近活跃的绑定用户。
        var user = await channels.GetLatestBoundUserAsync(sub.TargetId, cts.Token);
        if (user == null) return;
        var ch = await channels.GetChannelAsync(sub.TargetId, includeSecrets: true, cts.Token);
        if (ch == null || !ch.Enabled) return;

        var channelSession = await ai.GetOrCreateChannelSessionAsync(
            ch.Id, ch.ChannelType, user.ExternalId, user.ExternalName, user.BoundUserId, user.BoundUserName,
            ch.DefaultProviderId, ch.DefaultModel, cts.Token);

        var buf = new StringBuilder();
        await ai.RunChatAsync(channelSession, prompt, async payload =>
        {
            try
            {
                var evt = JsonNode.Parse(payload) as JsonObject;
                if (evt?["type"]?.GetValue<string>() == "message")
                    buf.Append(evt["delta"]?.GetValue<string>() ?? "");
            }
            catch { /* 忽略单帧解析失败 */ }
        }, cts.Token, JustitiaTier.Cognitio);

        var channelReply = buf.ToString().Trim();
        if (channelReply.Length == 0) return;
        try
        {
            // 频道适配器发送（微信 iLink 需要 context_token，服务端主动事件可能无缓存 → 失败会被记录，不影响控制台会话侧）。
            await channels.SendChannelTextAsync(ch.Id, user.ExternalId, channelReply, cts.Token);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AI event notify: channel send failed (channel {Channel} → {External})", ch.Id, user.ExternalId);
        }
        await ws.BroadcastToConsoleAsync(new WebSocketMessage
        {
            Type = "ai.notify",
            Channel = "console",
            Data = JsonSerializer.SerializeToElement(new
            {
                sessionId = channelSession.Id,
                eventType,
                agentId,
                text = channelReply,
                channelId = ch.Id,
                externalName = user.ExternalName,
            }),
        }, cts.Token);
    }
}
