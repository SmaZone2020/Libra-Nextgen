using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// Plugin action gateway: turns a frontend button press into an agent task.
///
/// The route is <c>/api/plugins/{pluginId}/{action}</c>. The handler validates
/// the action against the plugin's declared meta, then relays a generic
/// <c>plugin.exec</c> message to the target agent over WebSocket and waits for
/// the agent's result. No plugin-authored server code runs here — the plugin's
/// behavior maps declaratively to a module invocation on the Agent.
/// </summary>
[ApiController]
[Route("api/plugins/{pluginId}")]
[Authorize]
public class PluginActionController : ControllerBase
{
    private readonly PluginService _plugins;
    private readonly RelayService _relay;

    public PluginActionController(PluginService plugins, RelayService relay)
    {
        _plugins = plugins;
        _relay = relay;
    }

    [HttpPost("{actionName}")]
    public async Task<IActionResult> Execute(
        string pluginId, string actionName, [FromBody] JsonElement? body, CancellationToken ct)
    {
        var plugin = await _plugins.GetByPluginIdAsync(pluginId, ct);
        if (plugin == null)
            return NotFound(new { error = "Plugin not found." });
        if (!plugin.Enabled)
            return StatusCode(409, new { error = "Plugin is disabled." });

        var def = plugin.Actions.FirstOrDefault(a => a.Action == actionName);
        if (def == null)
            return NotFound(new { error = $"Action '{actionName}' not found." });

        // Agent selection: body.agentId or a top-level query param.
        body ??= JsonSerializer.Deserialize<JsonElement>("{}");
        var agentId = ReadString(body.Value, "agentId")
            ?? Request.Query["agentId"].FirstOrDefault();
        if (string.IsNullOrEmpty(agentId))
            return BadRequest(new { error = "agentId is required." });

        // Argument validation against the declared argsSchema (best-effort
        // structural check; the agent module remains authoritative).
        var args = ReadObject(body.Value, "args");
        if (!ValidateArgs(def.ArgsSchema, args))
            return BadRequest(new { error = "Arguments do not match the plugin schema." });

        // Build the module input JSON: {"op": "...", ...args}.
        var input = new Dictionary<string, object?>();
        if (!string.IsNullOrEmpty(def.Module?.Op))
            input["op"] = def.Module!.Op;
        if (args != null)
            foreach (var kv in args)
                input[kv.Key] = kv.Value;

        // Relay. If no module is declared, this is a server-legacy action with
        // no agent round-trip — treat it as an accepted no-op with a placeholder.
        if (def.Module == null)
            return Ok(new { pluginId, action = actionName, status = "accepted" });

        var kind = string.Equals(def.Module.Kind, "script", StringComparison.OrdinalIgnoreCase)
            ? "script" : "native";

        object relayPayload;
        if (kind == "script")
        {
            var script = LoadScriptSource(plugin.PluginId, def.Module.Name);
            if (script == null)
                return NotFound(new { error = $"script module '{def.Module.Name}.rhai' not found" });
            relayPayload = new
            {
                kind = "script",
                module = def.Module.Name,
                action = actionName,
                entry = def.Module.Entry ?? "main",
                script,
                features = new string[0],
                input,
            };
        }
        else
        {
            relayPayload = new
            {
                kind = "native",
                module = def.Module.Name,
                action = actionName,
                input,
            };
        }

        var result = await _relay.RelayAndWaitAsync(agentId, "plugin.exec", relayPayload, ct);

        if (result == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });

        return Ok(new { pluginId, action = actionName, result = result.Data });
    }

    // ── helpers ────────────────────────────────────────────────────────

    /// <summary>Read a plugin's Rhai script source (cached by PluginService),
    /// guarding against path traversal.</summary>
    private static string? LoadScriptSource(string pluginId, string name)
        => PluginService.GetScriptSource(pluginId, name);

    private static string? ReadString(JsonElement root, string key)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        return root.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;
    }

    private static Dictionary<string, object?>? ReadObject(JsonElement root, string key)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        if (!root.TryGetProperty(key, out var v) || v.ValueKind != JsonValueKind.Object)
            return null;

        var dict = new Dictionary<string, object?>();
        foreach (var prop in v.EnumerateObject())
            dict[prop.Name] = ToClr(prop.Value);
        return dict;
    }

    private static object? ToClr(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        JsonValueKind.Array => e.EnumerateArray().Select(ToClr).ToList(),
        JsonValueKind.Object => e.EnumerateObject().ToDictionary(p => p.Name, p => ToClr(p.Value)),
        _ => e.GetRawText(),
    };

    private static bool ValidateArgs(PluginArgsSchema? schema, Dictionary<string, object?>? args)
    {
        if (schema == null || schema.Properties == null)
            return true; // no schema — accept anything

        args ??= new Dictionary<string, object?>();

        // Required-field presence check.
        if (schema.Required != null)
        {
            foreach (var req in schema.Required)
                if (!args.ContainsKey(req))
                    return false;
        }

        // Type check for declared properties (loose: string properties accept
        // any scalar; unknown properties are tolerated for forward-compat).
        foreach (var (name, prop) in schema.Properties)
        {
            if (!args.TryGetValue(name, out var value) || value == null) continue;
            if (prop.Type == "string" && value is not string) return false;
            if (prop.Type == "number" && value is not (int or long or double or float)) return false;
            if (prop.Type == "boolean" && value is not bool) return false;
        }
        return true;
    }
}
