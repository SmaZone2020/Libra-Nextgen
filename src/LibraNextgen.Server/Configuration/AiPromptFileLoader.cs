using Microsoft.Extensions.Options;

namespace LibraNextgen.Service.Configuration;

/// <summary>
/// </summary>
public class AiPromptFileLoader : IDisposable
{
    private readonly IOptions<AiSettings> _options;
    private readonly ILogger<AiPromptFileLoader> _logger;
    private readonly IHostEnvironment _env;
    private readonly object _lock = new();
    private FileSystemWatcher? _watcher;
    private string? _resolvedPath;
    private string? _cached;
    private readonly Lazy<string?> _inlinePrompt;

    public AiPromptFileLoader(
        IOptions<AiSettings> options,
        ILogger<AiPromptFileLoader> logger,
        IHostEnvironment env)
    {
        _options = options;
        _logger = logger;
        _env = env;
        _inlinePrompt = new Lazy<string?>(() =>
        {
            var inline = _options.Value.SystemPrompt?.Trim();
            return string.IsNullOrEmpty(inline) ? null : inline;
        });
    }

    public string? Current
    {
        get
        {
            if (_inlinePrompt.Value is { } inline) return inline;
            lock (_lock)
            {
                if (_cached != null) return _cached;
                var path = ResolvePath();
                if (path == null) return null;
                try
                {
                    var text = File.ReadAllText(path).Trim();
                    _cached = text.Length > 0 ? text : null;
                    if (_cached != null) Watch(path);
                    return _cached;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to read system prompt file {Path}", path);
                    return null;
                }
            }
        }
    }

    private string? ResolvePath()
    {
        if (_resolvedPath != null) return _resolvedPath;

        var configured = _options.Value.SystemPromptFile;
        if (string.IsNullOrWhiteSpace(configured)) return null;

        if (Path.IsPathRooted(configured) && File.Exists(configured))
        {
            _resolvedPath = configured;
            return _resolvedPath;
        }

        var root = _env.ContentRootPath;
        if (!string.IsNullOrEmpty(root))
        {
            var candidate = Path.Combine(root, configured);
            if (File.Exists(candidate))
            {
                _resolvedPath = Path.GetFullPath(candidate);
                return _resolvedPath;
            }
        }

        var baseDir = AppContext.BaseDirectory;
        var srcCandidate = Path.Combine(baseDir, "..", "..", "..", configured);
        if (File.Exists(srcCandidate))
        {
            _resolvedPath = Path.GetFullPath(srcCandidate);
            return _resolvedPath;
        }

        _logger.LogWarning("System prompt file not found: {Configured} (searched content root and source fallback)", configured);
        return null;
    }

    private void Watch(string path)
    {
        if (_watcher != null) return;
        var dir = Path.GetDirectoryName(path);
        var file = Path.GetFileName(path);
        if (string.IsNullOrEmpty(dir) || string.IsNullOrEmpty(file)) return;

        try
        {
            _watcher = new FileSystemWatcher(dir, file)
            {
                NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName,
                EnableRaisingEvents = true,
            };
            _watcher.Changed += (_, _) => Invalidate();
            _watcher.Renamed += (_, _) => Invalidate();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to watch system prompt file {Path}", path);
        }
    }

    private void Invalidate()
    {
        lock (_lock)
        {
            _cached = null;
        }
    }

    public void Dispose()
    {
        _watcher?.Dispose();
        _watcher = null;
    }
}
