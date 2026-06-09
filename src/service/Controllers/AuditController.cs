using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

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

    /// <summary>
    /// List audit logs. Read-only — no delete endpoint available.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        var logs = await _auditService.GetRecentAsync(page, pageSize, ct);
        var total = await _auditService.CountAsync(ct);
        return Ok(new { logs, total, page, pageSize });
    }
}
