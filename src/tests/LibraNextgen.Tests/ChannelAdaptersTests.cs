using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;
using Telegram.Bot.Types.ReplyMarkups;
using TgUser = Telegram.Bot.Types.User;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// AI 频道适配器回归测试（Telegram 基于 Telegram.Bot 库的纯逻辑层）。
/// 覆盖：消息规范化（TryParseMessage）、审批内联按钮令牌（BuildApprovalMarkup /
/// ResolveCallback：解析/过期/归属校验/临时批准时长）。
/// </summary>
public class ChannelAdaptersTests
{
    private static AiChannel TelegramChannel() => new()
    {
        Id = "ch-tg",
        Name = "test",
        ChannelType = AiChannelTypes.Telegram,
        Config = new Dictionary<string, string> { ["botToken"] = "test:token" },
    };

    private static TelegramChannelAdapter NewAdapter() =>
        new(NullLogger<TelegramChannelAdapter>.Instance);

    private static Message TextMessage(long chatId, long fromId, string text, int messageId = 1, bool isBot = false) =>
        new()
        {
            Id = messageId,
            Text = text,
            From = new TgUser { Id = fromId, IsBot = isBot, FirstName = "Tester" },
            Chat = new Chat { Id = chatId, Type = ChatType.Private },
        };

    /// <summary>从审批键盘中提取第一个批准按钮的令牌（测试辅助）。</summary>
    private static string TokenFromMarkup(InlineKeyboardMarkup markup)
    {
        foreach (var row in markup.InlineKeyboard)
        {
            foreach (var btn in row)
            {
                if (btn.CallbackData?.StartsWith("ap:", StringComparison.Ordinal) == true)
                    return btn.CallbackData.Split(':')[1];
            }
        }
        throw new InvalidOperationException("approval button not found in markup");
    }

    private static CallbackQuery ApprovalCallback(
        TelegramChannelAdapter adapter, string data, long chatId, long fromId, string queryId = "cq-1") =>
        new()
        {
            Id = queryId,
            Data = data,
            From = new TgUser { Id = fromId },
            Message = TextMessage(chatId, chatId, "⏳ 审批"),
        };

    // ── 消息规范化 ────────────────────────────────────────────────────────

    [Fact]
    public void ParseMessage_TextFromUser_YieldsInbound()
    {
        var inbound = TelegramChannelAdapter.TryParseMessage(TelegramChannel(), TextMessage(42, 42, "hello", 7));
        Assert.NotNull(inbound);
        Assert.Equal("ch-tg", inbound!.ChannelId);
        Assert.Equal("42", inbound.ExternalId);
        Assert.Equal("hello", inbound.Text);
        Assert.Equal("Tester", inbound.ExternalName);
        Assert.Equal("7", inbound.DedupeKey);
    }

    [Fact]
    public void ParseMessage_IgnoresBotAndEmptyText()
    {
        Assert.Null(TelegramChannelAdapter.TryParseMessage(TelegramChannel(), TextMessage(1, 999, "i am bot", 1, isBot: true)));
        Assert.Null(TelegramChannelAdapter.TryParseMessage(TelegramChannel(), TextMessage(1, 1, "", 2)));
        Assert.Null(TelegramChannelAdapter.TryParseMessage(TelegramChannel(), TextMessage(1, 1, "   ", 3)));
    }

    // ── 审批内联按钮令牌 ──────────────────────────────────────────────────

    [Fact]
    public void ApprovalMarkup_HasApproveAndRejectButtons_WithShortData()
    {
        var adapter = NewAdapter();
        var markup = adapter.BuildApprovalMarkup("ch-tg", "42", "session-1", "call-1");

        var rows = markup.InlineKeyboard.ToList();
        Assert.Collection(rows,
            r => Assert.Equal(3, r.Count()), // 批准 / 5min / 20min
            r => Assert.Single(r));          // 拒绝

        // callback data 远小于 Telegram 64 字节上限。
        var data = rows[0].First().CallbackData!;
        Assert.True(data.Length <= 64, $"callback data {data.Length} bytes > 64");
        var token = TokenFromMarkup(markup);
        Assert.Equal(16, token.Length);
    }

    [Fact]
    public void ApprovalToken_ApproveWithPermit_Resolves()
    {
        var adapter = NewAdapter();
        var ch = TelegramChannel();
        var markup = adapter.BuildApprovalMarkup(ch.Id, "42", "session-1", "call-1");
        var token = TokenFromMarkup(markup);

        var cb = ApprovalCallback(adapter, $"ap:{token}:5m", 42, 42);
        var action = adapter.ResolveCallback(ch, cb);
        Assert.NotNull(action);
        Assert.True(action!.Approved);
        Assert.Equal("5min", action.Permit);
        Assert.Equal("session-1", action.SessionId);
        Assert.Equal("call-1", action.ToolCallId);
        Assert.Equal("42", action.ChatId);
        Assert.Equal("cq-1", action.CallbackQueryId);
    }

    [Fact]
    public void ApprovalToken_DefaultPermit_IsOneTime()
    {
        var adapter = NewAdapter();
        var ch = TelegramChannel();
        var token = TokenFromMarkup(adapter.BuildApprovalMarkup(ch.Id, "42", "s", "c"));
        var action = adapter.ResolveCallback(ch, ApprovalCallback(adapter, $"ap:{token}:ot", 42, 42));
        Assert.NotNull(action);
        Assert.True(action!.Approved);
        Assert.Equal("one-time", action.Permit);
    }

    [Fact]
    public void ApprovalToken_RejectButton_ResolvesRejected()
    {
        var adapter = NewAdapter();
        var ch = TelegramChannel();
        var token = TokenFromMarkup(adapter.BuildApprovalMarkup(ch.Id, "42", "s", "c"));
        var action = adapter.ResolveCallback(ch, ApprovalCallback(adapter, $"rj:{token}", 42, 42));
        Assert.NotNull(action);
        Assert.False(action!.Approved);
        Assert.Equal("one-time", action.Permit);
    }

    [Fact]
    public void ApprovalToken_WrongOwner_IsRejected()
    {
        var adapter = NewAdapter();
        var ch = TelegramChannel();
        var token = TokenFromMarkup(adapter.BuildApprovalMarkup(ch.Id, "42", "s", "c"));
        // 另一个 chat 点击同一按钮（归属校验失败）。
        Assert.Null(adapter.ResolveCallback(ch, ApprovalCallback(adapter, $"ap:{token}:ot", 999, 999)));
    }

    [Fact]
    public void ApprovalToken_UnknownOrMalformed_IsRejected()
    {
        var adapter = NewAdapter();
        var ch = TelegramChannel();
        var token = TokenFromMarkup(adapter.BuildApprovalMarkup(ch.Id, "42", "s", "c"));
        Assert.NotNull(token);

        Assert.Null(adapter.ResolveCallback(ch, ApprovalCallback(adapter, "ap:deadbeefdeadbeef:ot", 42, 42)));
        Assert.Null(adapter.ResolveCallback(ch, ApprovalCallback(adapter, "ap:xyz", 42, 42)));
        Assert.Null(adapter.ResolveCallback(ch, ApprovalCallback(adapter, "unknown:data", 42, 42)));
    }

    // ── 菜单按钮回调解析 ──────────────────────────────────────────────────

    [Fact]
    public void MenuCallback_ParsesModelNavSelectSearchAndTier()
    {
        var adapter = NewAdapter();
        var ch = TelegramChannel();
        var cq = new CallbackQuery
        {
            Id = "cq-m1",
            Data = "mdl:nav:2",
            From = new TgUser { Id = 42 },
            Message = TextMessage(42, 42, "选择模型（1/3）"),
        };
        var nav = adapter.TryResolveMenu(ch, cq);
        Assert.NotNull(nav);
        Assert.Equal("model-nav", nav!.Kind);
        Assert.Equal("2", nav.Data);
        Assert.Equal("42", nav.ChatId);

        cq.Data = "mdl:sel:7";
        var sel = adapter.TryResolveMenu(ch, cq);
        Assert.NotNull(sel);
        Assert.Equal("model-select", sel!.Kind);
        Assert.Equal("7", sel.Data);

        cq.Data = "mdl:sea";
        var sea = adapter.TryResolveMenu(ch, cq);
        Assert.NotNull(sea);
        Assert.Equal("model-search", sea!.Kind);

        cq.Data = "tier:sel:1";
        var tier = adapter.TryResolveMenu(ch, cq);
        Assert.NotNull(tier);
        Assert.Equal("tier-select", tier!.Kind);
        Assert.Equal("1", tier.Data);

        // 帮助快捷菜单。
        cq.Data = "help:model";
        Assert.Equal("help-model", adapter.TryResolveMenu(ch, cq)!.Kind);
        cq.Data = "help:tier";
        Assert.Equal("help-tier", adapter.TryResolveMenu(ch, cq)!.Kind);
        cq.Data = "help:status";
        Assert.Equal("help-status", adapter.TryResolveMenu(ch, cq)!.Kind);

        // 审批/未知前缀不识别为菜单。
        cq.Data = "ap:abcdef1234567890:ot";
        Assert.Null(adapter.TryResolveMenu(ch, cq));
        cq.Data = "garbage";
        Assert.Null(adapter.TryResolveMenu(ch, cq));
    }

    // ── 绑定码 ────────────────────────────────────────────────────────────

    [Fact]
    public void ChannelBindCode_IsDeterministicHash_AndDistinctCodesDiffer()
    {
        var a = AiChannelService.GenerateBindCode();
        var b = AiChannelService.GenerateBindCode();
        Assert.Equal(8, a.Length);
        Assert.NotEqual(a, b);
        Assert.Equal(AiChannelService.HashCode(a), AiChannelService.HashCode(a));
        Assert.NotEqual(AiChannelService.HashCode(a), AiChannelService.HashCode(b));
    }
}
