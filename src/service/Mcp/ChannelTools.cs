using System.ComponentModel;
using LibraNextgen.Service.Services;
using ModelContextProtocol.Server;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// </summary>
[McpServerToolType]
public static class ChannelTools
{
    /// <summary>
    /// </summary>
    [McpServerTool]
    [Description("向当前 IM 频道会话（Telegram/飞书/微信）的用户发送媒体消息。目标用户固定为当前对话者，不可指定他人。")]
    public static async Task<string> send_channel_media(
        [Description("媒体类型：photo（图片）| video（视频）| document（文件）| audio（音频）| animation（GIF）")] string type,
        [Description("媒体文件 URL（http/https），服务端直接拉取发送")] string url,
        [Description("可选：文件名（document 类型建议提供，如 report.pdf）")] string? fileName,
        [Description("可选：说明文字（显示在媒体下方）")] string? caption,
        AiChannelService channels,
        CancellationToken ct)
    {
        var ctx = AiRunContext.Current;
        if (ctx == null || ctx.ChannelId.Length == 0)
            return McpUtils.Error("当前会话不是 IM 频道会话，无法发送媒体");
        try
        {
            await channels.SendMediaToChannelAsync(ctx.ChannelId, ctx.ExternalId, type, url, fileName, caption, ct);
            return McpUtils.Ok(new { sent = true, type, to = ctx.ExternalId });
        }
        catch (Exception ex)
        {
            return McpUtils.Error($"发送失败：{ex.Message}");
        }
    }
}
