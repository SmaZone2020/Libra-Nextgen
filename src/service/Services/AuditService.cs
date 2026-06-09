using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services;

public class AuditService
{
    private readonly Repository<AuditLog> _auditLogs;

    public AuditService(Repository<AuditLog> auditLogs)
    {
        _auditLogs = auditLogs;
    }

    public async Task LogAsync(
        string userId, string userName, string action,
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
            Success = success
        };
        await _auditLogs.InsertAsync(entry);
    }

    public async Task<List<AuditLog>> GetRecentAsync(int page = 1, int pageSize = 50, CancellationToken ct = default)
    {
        var sort = MongoDB.Driver.Builders<AuditLog>.Sort.Descending(l => l.Timestamp);
        return await _auditLogs.FindPagedAsync(_ => true, page, pageSize, sort, ct);
    }

    public async Task<long> CountAsync(CancellationToken ct = default)
    {
        return await _auditLogs.CountAsync(ct: ct);
    }
}
