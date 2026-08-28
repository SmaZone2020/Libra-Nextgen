namespace LibraNextgen.Service.Configuration;

/// <summary>
/// AI 助手配置：Justitia 默认系统提示词。
/// 提示词全文存储在 appsettings.json 的 Ai:SystemPrompt（部署时可直接编辑）；
/// 代码内仅保留空默认值——配置缺失时该节不注入 system prompt。
/// </summary>
public class AiSettings
{
    public const string SectionName = "Ai";

    /// <summary>Justitia 宪法系统提示词（EN，10 节）。</summary>
    public string SystemPrompt { get; set; } = string.Empty;
}
