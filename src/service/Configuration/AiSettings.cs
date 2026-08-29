namespace LibraNextgen.Service.Configuration;

/// <summary>
/// AI 助手配置：Justitia 系统提示词从本地文件加载。
/// <see cref="SystemPromptFile"/> 指向提示词文件（.md/.txt），
/// 服务启动时读取并缓存；修改文件后由 <see cref="AiPromptFileLoader"/>
/// 的变更监听自动热更新，无需重启。
/// </summary>
public class AiSettings
{
    public const string SectionName = "Ai";

    /// <summary>提示词文件路径（相对 ContentRootPath 或绝对路径）。</summary>
    public string SystemPromptFile { get; set; } = "Configuration/justitia-system-prompt.md";

    /// <summary>兼容旧配置：直接内联的提示词文本（优先于文件）。</summary>
    public string? SystemPrompt { get; set; }
}
