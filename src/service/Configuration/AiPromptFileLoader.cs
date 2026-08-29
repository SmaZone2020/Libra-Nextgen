using Microsoft.Extensions.Options;

namespace LibraNextgen.Service.Configuration;

/// <summary>
/// 从本地文件加载 Justitia 系统提示词，带变更监听自动热更新。
/// 文件路径解析优先级：
///   1. 显式绝对路径；
///   2. ContentRootPath 下相对路径（bin 运行目录）；
///   3. 回退到源码目录（src/service/）下的同名相对路径（开发模式常用）。
/// 找不到文件时返回空（不注入 system prompt），并记录警告。
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

    /// <summary>当前提示词内容；内联配置优先，否则读文件（带缓存）。</summary>
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

    /// <summary>解析提示词文件绝对路径；找不到返回 null。</summary>
    private string? ResolvePath()
    {
        if (_resolvedPath != null) return _resolvedPath;

        var configured = _options.Value.SystemPromptFile;
        if (string.IsNullOrWhiteSpace(configured)) return null;

        // 1. 绝对路径
        if (Path.IsPathRooted(configured) && File.Exists(configured))
        {
            _resolvedPath = configured;
            return _resolvedPath;
        }

        // 2. ContentRootPath 下（bin 运行目录）
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

        // 3. 回退源码目录（开发模式：bin/Debug/netX 上跳 3 级到 src/service 下）
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

    /// <summary>监听文件变更，自动失效缓存实现热更新。</summary>
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
