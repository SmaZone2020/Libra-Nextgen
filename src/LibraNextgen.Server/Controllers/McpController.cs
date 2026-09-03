using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/mcp")]
[Authorize(Roles = "Admin")]
public class McpController : ControllerBase
{
    private readonly McpService _mcp;

    public McpController(McpService mcp)
    {
        _mcp = mcp;
    }

    [HttpGet("info")]
    public IActionResult Info()
    {
        return Ok(new
        {
            enabled = _mcp.Enabled,
            endpoint = "/mcp",
            transport = "Streamable HTTP",
            auth = "Access Key (Bearer)",
            tools = McpService.GetTools(),
        });
    }

    [HttpPost("toggle")]
    public async Task<IActionResult> Toggle([FromBody] McpToggleRequest request, CancellationToken ct)
    {
        await _mcp.SetEnabledAsync(request.Enabled, ct);
        return Ok(new { enabled = _mcp.Enabled });
    }
}

public class McpToggleRequest
{
    public bool Enabled { get; set; }
}
