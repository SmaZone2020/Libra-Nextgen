using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace LibraNextgen.Service.Services;

/// <summary>
/// 一次性下载凭证（core.bin 防枚举）：
/// loader 在 /api/v1/auth/token 协商 core 密钥时领取凭证，随后用它在
/// /api/v1/models/{buildId}?t=xxx 下载；凭证 5 分钟有效、一次性、绑定 buildId。
/// </summary>
public class DownloadTicketStore
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, (string BuildId, DateTime Expires)> _tickets = new();

    public string Issue(string buildId)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        _tickets[token] = (buildId, DateTime.UtcNow + Ttl);
        // 清理过期项（惰性，量小无碍）
        if (_tickets.Count > 512)
        {
            foreach (var (k, v) in _tickets)
            {
                if (v.Expires < DateTime.UtcNow) _tickets.TryRemove(k, out _);
            }
        }
        return token;
    }

    /// <summary>校验并消费凭证：匹配 buildId 且未过期 → 移除并返回 true。</summary>
    public bool Consume(string buildId, string token)
    {
        if (string.IsNullOrEmpty(token) || !_tickets.TryRemove(token, out var entry))
            return false;
        return entry.BuildId == buildId && entry.Expires >= DateTime.UtcNow;
    }
}
