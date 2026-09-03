using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/risk-policy")]
[Authorize(Roles = "Admin")]
public class RiskPolicyController : ControllerBase
{
    private readonly RiskPolicyService _riskPolicy;

    public RiskPolicyController(RiskPolicyService riskPolicy)
    {
        _riskPolicy = riskPolicy;
    }

    [HttpGet]
    public IActionResult Get()
    {
        return Ok(new
        {
            mappings = _riskPolicy.GetMappings(),
            defaults = RiskActions.DefaultMappings(),
        });
    }

    [HttpPut]
    public async Task<IActionResult> Save([FromBody] RiskPolicyUpdateRequest request, CancellationToken ct)
    {
        await _riskPolicy.SaveAsync(request.Mappings, ct);
        return Ok(new { status = "ok" });
    }
}

public class RiskPolicyUpdateRequest
{
    public Dictionary<string, RiskLevel> Mappings { get; set; } = new();
}
