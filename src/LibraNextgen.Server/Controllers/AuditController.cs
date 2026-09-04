using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/audit")]
[Authorize(Roles = "Admin")]
public class AuditController : ControllerBase
{
    private readonly AuditService _auditService;

    public AuditController(AuditService auditService)
    {
        _auditService = auditService;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 80,
        [FromQuery] string? query = null,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        [FromQuery] bool excludeHeartbeats = true,
        [FromQuery] string? risk = null,
        CancellationToken ct = default)
    {
        RiskLevel? riskLevel = null;
        if (!string.IsNullOrWhiteSpace(risk) && Enum.TryParse<RiskLevel>(risk, true, out var parsed))
            riskLevel = parsed;

        var (logs, total) = await _auditService.GetPagedAsync(page, pageSize, query, from, to, excludeHeartbeats, riskLevel, ct);
        return Ok(new { logs, total, page, pageSize });
    }
}
