namespace LibraNextgen.Service.Configuration;

/// <summary>
/// </summary>
public class AiSettings
{
    public const string SectionName = "Ai";

    public string SystemPromptFile { get; set; } = "Configuration/justitia-system-prompt.md";

    public string? SystemPrompt { get; set; }
}
