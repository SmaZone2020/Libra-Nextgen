using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Middleware;

/// <summary>Blocks the /mcp endpoint when the MCP server is disabled.</summary>
public class McpToggleMiddleware
{
    private readonly RequestDelegate _next;

    public McpToggleMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, McpService mcp)
    {
        if (!mcp.Enabled && context.Request.Path.StartsWithSegments("/mcp"))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            await context.Response.WriteAsJsonAsync(new { error = "MCP server is disabled" });
            return;
        }

        await _next(context);
    }
}
