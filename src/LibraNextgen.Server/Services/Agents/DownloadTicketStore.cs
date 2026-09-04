using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace LibraNextgen.Service.Services.Agents;

/// <summary>
/// </summary>
public class DownloadTicketStore
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, (string BuildId, DateTime Expires)> _tickets = new();

    public string Issue(string buildId)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        _tickets[token] = (buildId, DateTime.UtcNow + Ttl);
        if (_tickets.Count > 512)
        {
            foreach (var (k, v) in _tickets)
            {
                if (v.Expires < DateTime.UtcNow) _tickets.TryRemove(k, out _);
            }
        }
        return token;
    }

    public bool Consume(string buildId, string token)
    {
        if (string.IsNullOrEmpty(token) || !_tickets.TryRemove(token, out var entry))
            return false;
        return entry.BuildId == buildId && entry.Expires >= DateTime.UtcNow;
    }
}
