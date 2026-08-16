using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services;

public class AuditService
{
    private readonly Repository<AuditLog> _auditLogs;
    private readonly RiskPolicyService _riskPolicy;

    public AuditService(Repository<AuditLog> auditLogs, RiskPolicyService riskPolicy)
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

    public async Task<(List<AuditLog> logs, long total)> GetPagedAsync(
        int page, int pageSize, string? query = null,
        DateTime? from = null, DateTime? to = null, bool excludeHeartbeats = true,
        RiskLevel? risk = null, CancellationToken ct = default)
    {
        pageSize = Math.Clamp(pageSize, 1, 80);

        var builder = Builders<AuditLog>.Filter;
        var filters = new List<FilterDefinition<AuditLog>>();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var q = System.Text.RegularExpressions.Regex.Escape(query.Trim());
            var searchFilter = builder.Or(
                builder.Regex(l => l.UserName, new MongoDB.Bson.BsonRegularExpression(q, "i")),
                builder.Regex(l => l.Action, new MongoDB.Bson.BsonRegularExpression(q, "i")),
                builder.Regex(l => l.IpAddress, new MongoDB.Bson.BsonRegularExpression(q, "i")),
                builder.Regex(l => l.TargetAgentId, new MongoDB.Bson.BsonRegularExpression(q, "i"))
            );
            filters.Add(searchFilter);
        }

        if (risk.HasValue)
            filters.Add(builder.Eq(l => l.Risk, risk.Value));

        if (excludeHeartbeats)
            filters.Add(builder.Ne(l => l.Action, "POST /api/beacon/heartbeat"));
        if (from.HasValue)
            filters.Add(builder.Gte(l => l.Timestamp, from.Value));
        if (to.HasValue)
            filters.Add(builder.Lte(l => l.Timestamp, to.Value));

        var filter = filters.Count > 0 ? builder.And(filters) : FilterDefinition<AuditLog>.Empty;
        var sort = Builders<AuditLog>.Sort.Descending(l => l.Timestamp);

        var logs = await _auditLogs.FindPagedAsync(filter, page, pageSize, sort, ct);
        var total = await _auditLogs.CountAsync(filter, ct);

        return (logs, total);
    }
}
