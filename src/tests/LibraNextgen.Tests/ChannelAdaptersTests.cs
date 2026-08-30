using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// AI 频道适配器回归测试。
/// 重点覆盖 Telegram 长轮询的 offset 确认语义：
/// 游标必须推进到「最大已处理 update_id + 1」，否则同一条消息被无限重复下发
/// （表现为 bot 对一条消息反复响应——曾作为线上 bug 出现）。
/// </summary>
public class ChannelAdaptersTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;
        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) => _responder = responder;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(_responder(request));
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public StubHttpClientFactory(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler);
    }

    private static AiChannel TelegramChannel() => new()
    {
        Id = "ch-tg",
        Name = "test",
        ChannelType = AiChannelTypes.Telegram,
        Config = new Dictionary<string, string> { ["botToken"] = "test:token" },
    };

    private static HttpResponseMessage Json(HttpStatusCode code, string body) => new(code)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };

    [Fact]
    public async Task TelegramPoll_AdvancesOffsetToMaxUpdateIdPlusOne_AndDoesNotRepeat()
    {
        var requested = new List<string>();
        var handler = new StubHandler(req =>
        {
            lock (requested) requested.Add(req.RequestUri?.ToString() ?? "");
            var url = req.RequestUri?.ToString() ?? "";
            // offset < 101：返回一条 update_id=100 的用户消息；offset >= 101：空。
            var offset = url.Contains("offset=")
                ? long.Parse(url.Split("offset=")[1].Split('&')[0])
                : 0;
            if (offset < 101)
            {
                return Json(HttpStatusCode.OK, """
                {"ok":true,"result":[
                  {"update_id":100,
                   "message":{"message_id":7,"from":{"id":42,"is_bot":false,"first_name":"Tester"},
                              "chat":{"id":42,"first_name":"Tester"},"text":"hello"}}
                ]}
                """);
            }
            return Json(HttpStatusCode.OK, """{"ok":true,"result":[]}""");
        });

        var adapter = new TelegramChannelAdapter(
            new StubHttpClientFactory(handler),
            NullLogger<TelegramChannelAdapter>.Instance);
        var channel = TelegramChannel();

        // 第一轮：从 0 拉取，游标必须推进到 101（最大 update_id + 1）。
        var first = await adapter.PollAsync(channel, "", CancellationToken.None);
        Assert.Equal("101", first.NewCursor);
        var msg = Assert.Single(first.Messages);
        Assert.Equal("hello", msg.Text);
        Assert.Equal("42", msg.ExternalId);
        Assert.Equal("100", msg.DedupeKey);

        // 第二轮：用推进后的游标再拉，服务端只返回 update_id >= 101 的更新 → 空。
        // 若游标被错误推进到 100，这里会再次返回同一条消息（回归断言）。
        var second = await adapter.PollAsync(channel, first.NewCursor, CancellationToken.None);
        Assert.Equal("101", second.NewCursor);
        Assert.Empty(second.Messages);

        // 请求确实带上了推进后的 offset。
        Assert.Contains(requested, u => u.Contains("offset=101", StringComparison.Ordinal));
    }

    [Fact]
    public async Task TelegramPoll_MultipleUpdates_AdvancesToMaxPlusOne_AndDedupeKeysAreUnique()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.OK, """
            {"ok":true,"result":[
              {"update_id":101,"message":{"message_id":1,"from":{"id":1,"is_bot":false,"first_name":"A"},"chat":{"id":1},"text":"one"}},
              {"update_id":102,"message":{"message_id":2,"from":{"id":2,"is_bot":false,"first_name":"B"},"chat":{"id":2},"text":"two"}},
              {"update_id":105,"message":{"message_id":3,"from":{"id":1,"is_bot":false,"first_name":"A"},"chat":{"id":1},"text":"three"}}
            ]}
            """));

        var adapter = new TelegramChannelAdapter(
            new StubHttpClientFactory(handler),
            NullLogger<TelegramChannelAdapter>.Instance);

        var batch = await adapter.PollAsync(TelegramChannel(), "", CancellationToken.None);
        Assert.Equal("106", batch.NewCursor); // max 105 + 1
        Assert.Equal(3, batch.Messages.Count);
        Assert.Equal(3, batch.Messages.Select(m => m.DedupeKey).Distinct().Count());
        Assert.Equal(new[] { "101", "102", "105" }, batch.Messages.Select(m => m.DedupeKey).OrderBy(x => x));
    }

    [Fact]
    public async Task TelegramPoll_EmptyResult_KeepsCursor()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.OK, """{"ok":true,"result":[]}"""));
        var adapter = new TelegramChannelAdapter(
            new StubHttpClientFactory(handler),
            NullLogger<TelegramChannelAdapter>.Instance);

        var batch = await adapter.PollAsync(TelegramChannel(), "42", CancellationToken.None);
        Assert.Equal("42", batch.NewCursor);
        Assert.Empty(batch.Messages);
    }

    [Fact]
    public async Task TelegramPoll_IgnoresBotMessages()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.OK, """
            {"ok":true,"result":[
              {"update_id":200,"message":{"message_id":9,"from":{"id":999,"is_bot":true,"first_name":"Bot"},"chat":{"id":42},"text":"i am bot"}},
              {"update_id":201,"message":{"message_id":10,"from":{"id":42,"is_bot":false,"first_name":"Tester"},"chat":{"id":42},"text":"real"}}
            ]}
            """));
        var adapter = new TelegramChannelAdapter(
            new StubHttpClientFactory(handler),
            NullLogger<TelegramChannelAdapter>.Instance);

        var batch = await adapter.PollAsync(TelegramChannel(), "", CancellationToken.None);
        Assert.Equal("202", batch.NewCursor); // 两条 update 都要确认
        var msg = Assert.Single(batch.Messages);
        Assert.Equal("real", msg.Text);
    }

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
