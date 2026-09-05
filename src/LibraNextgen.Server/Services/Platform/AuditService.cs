using System.Linq.Expressions;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services.Platform;

public class AuditService
{
    private readonly IStore<AuditLog> _auditLogs;
    private readonly RiskPolicyService _riskPolicy;

    public AuditService(IStore<AuditLog> auditLogs, RiskPolicyService riskPolicy)
    {
        _auditLogs = auditLogs;
        _riskPolicy = riskPolicy;
    }

    public async Task LogAsync(
        string userId, string userName, string action, string? actionKey,
        string? targetAgentId, string? details, string ipAddress, bool success = true)
    {
        var entry = new AuditLog
        {
            UserId = userId,
            UserName = userName,
            Action = action,
            TargetAgentId = targetAgentId,
            Details = details,
            IpAddress = ipAddress,
            Success = success,
            Risk = _riskPolicy.GetRisk(actionKey)
        };
        await _auditLogs.InsertAsync(entry);
    }

    public async Task LogAsync(
        string userId, string userName, string action, string? actionKey,
        string? targetAgentId, string? details, string ipAddress,
        RiskLevel risk, bool success = true)
    {
        var entry = new AuditLog
        {
            UserId = userId,
            UserName = userName,
            Action = action,
            TargetAgentId = targetAgentId,
            Details = details,
            IpAddress = ipAddress,
            Success = success,
            Risk = risk,
        };
        await _auditLogs.InsertAsync(entry);
    }

    /// <summary>Case-insensitive literal search across the four free-text
    /// fields. ToLower().Contains() is used deliberately: the Mongo LINQ
    /// translator supports it, while Contains(..., OrdinalIgnoreCase) throws
    /// ExpressionNotSupportedException (verified against MongoDB.Driver 3.x).</summary>
    private static Expression<Func<AuditLog, bool>> TextSearch(string queryLower) =>
        log => (log.UserName != null && log.UserName.ToLower().Contains(queryLower))
            || (log.Action != null && log.Action.ToLower().Contains(queryLower))
            || (log.IpAddress != null && log.IpAddress.ToLower().Contains(queryLower))
            || (log.TargetAgentId != null && log.TargetAgentId.ToLower().Contains(queryLower));

    public async Task<(List<AuditLog> logs, long total)> GetPagedAsync(
        int page, int pageSize, string? query = null,
        DateTime? from = null, DateTime? to = null, bool excludeHeartbeats = true,
        RiskLevel? risk = null, CancellationToken ct = default)
    {
        pageSize = Math.Clamp(pageSize, 1, 80);

        var parts = new List<Expression<Func<AuditLog, bool>>>();

        if (!string.IsNullOrWhiteSpace(query))
            parts.Add(TextSearch(query.Trim().ToLowerInvariant()));

        if (risk.HasValue)
            parts.Add(log => log.Risk == risk.Value);

        if (excludeHeartbeats)
            parts.Add(log => log.Action != "POST /api/beacon/heartbeat");

        if (from.HasValue)
            parts.Add(log => log.Timestamp >= from.Value);

        if (to.HasValue)
            parts.Add(log => log.Timestamp <= to.Value);

        var predicate = parts.Count == 0
            ? (Expression<Func<AuditLog, bool>>)(_ => true)
            : parts.Aggregate(ExpressionCombine.AndAlso);

        var logs = await _auditLogs.FindPagedAsync(predicate, page, pageSize, nameof(AuditLog.Timestamp), true, ct);
        var total = await _auditLogs.CountAsync(predicate, ct);

        return (logs, total);
    }
}
