using System.Text.Json.Serialization;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Models;

/// <summary>
/// A persisted plugin record. Mirrors the plugin package's `meta.json` plus
/// runtime lifecycle state (enabled flag, extracted path, timestamps).
/// </summary>
public class PluginRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string PluginId { get; set; } = "";     // com.example.soft-recon
    public string Name { get; set; } = "";
    public string Version { get; set; } = "1.0.0";
    public string Author { get; set; } = "";
    public string Description { get; set; } = "";
    public PluginEntry? Entry { get; set; }
    public Dictionary<string, Dictionary<string, string>>? I18n { get; set; }
    public List<PluginAction> Actions { get; set; } = new();
    public bool Enabled { get; set; }
    public string InstalledAt { get; set; } = "";
    public string? UpdatedAt { get; set; }
}

/// <summary>Frontend registration metadata from the plugin package.</summary>
public class PluginEntry
{
    public string Route { get; set; } = "";        // path segment under /plugins/
    public string Label { get; set; } = "";        // i18n key
    public string Icon { get; set; } = "Cpu";      // @gravity-ui/icons name (whitelisted)
    public string ApiRoot { get; set; } = "";      // e.g. /api/plugins/anothersoft
}

/// <summary>A capability the plugin exposes: a button → backend → agent flow.</summary>
public class PluginAction
{
    public string Action { get; set; } = "";
    public string Label { get; set; } = "";
    public string Method { get; set; } = "POST";
    public PluginArgsSchema? ArgsSchema { get; set; }
    public PluginModuleRef? Module { get; set; }
}

/// <summary>JSON Schema (subset) driving the frontend form and validation.</summary>
public class PluginArgsSchema
{
    public string Type { get; set; } = "object";
    public Dictionary<string, PluginArgProperty>? Properties { get; set; }
    public List<string>? Required { get; set; }
}

public class PluginArgProperty
{
    public string Type { get; set; } = "string";
    public string? Title { get; set; }
}

/// <summary>Maps an action to an Agent-side in-memory module invocation.</summary>
public class PluginModuleRef
{
    /// <summary>"script" (Rhai source) or "native" (compiled cdylib). Defaults
    /// to "native" when absent for backward compatibility.</summary>
    public string Kind { get; set; } = "native";

    /// <summary>Module name the agent's ModuleManager downloads (native), or
    /// the script file stem (script).</summary>
    public string Name { get; set; } = "";

    /// <summary>op field injected into the module input JSON.</summary>
    public string? Op { get; set; }

    /// <summary>Script entry function name (script kind only; defaults "main").</summary>
    public string? Entry { get; set; }
}

/// <summary>A parsed plugin package's meta.json (deserialization target).</summary>
public class PluginMeta
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = 1;

    [JsonPropertyName("pluginId")]
    public string PluginId { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("version")]
    public string Version { get; set; } = "1.0.0";

    [JsonPropertyName("author")]
    public string Author { get; set; } = "";

    [JsonPropertyName("description")]
    public string Description { get; set; } = "";

    [JsonPropertyName("entry")]
    public PluginEntry? Entry { get; set; }

    [JsonPropertyName("i18n")]
    public Dictionary<string, Dictionary<string, string>>? I18n { get; set; }

    [JsonPropertyName("actions")]
    public List<PluginAction> Actions { get; set; } = new();
}

/// <summary>Request to create a plugin from a raw meta.json (no archive upload).</summary>
public class PluginCreateRequest
{
    public PluginMeta? Meta { get; set; }
}

/// <summary>Request to enable/disable a plugin.</summary>
public class PluginToggleRequest
{
    public bool Enabled { get; set; }
}
