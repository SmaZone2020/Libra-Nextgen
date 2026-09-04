using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services.Ai;
using System.Text.Json.Nodes;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// </summary>
public class AiServiceHistoryTests
{
    private static AiMessage UserMsg(string content) => new() { Role = "user", Content = content };

    private static AiMessage AssistantWithToolCalls(params AiToolCall[] calls) => new()
    {
        Role = "assistant",
        Content = "let me check that",
        ToolCalls = calls.ToList(),
    };

    private static AiToolCall DoneCall(string id, string name, string args, string output) => new()
    {
        Id = id,
        ToolName = name,
        ArgsText = args,
        State = "output-available",
        Output = output,
    };

    private static AiToolCall ErrorCall(string id, string name, string args, string error) => new()
    {
        Id = id,
        ToolName = name,
        ArgsText = args,
        State = "error",
        Error = error,
    };

    private static AiToolCall PendingCall(string id, string name, string args) => new()
    {
        Id = id,
        ToolName = name,
        ArgsText = args,
        State = "requires-action",
    };

    [Fact]
    public void CompletedToolCall_IsFollowedByToolResult()
    {
        var messages = new List<AiMessage>
        {
            UserMsg("list files"),
            AssistantWithToolCalls(DoneCall("call_1", "list_files", "{}", "[\"a.txt\",\"b.txt\"]")),
            UserMsg("thanks"),
        };

        var llm = AiService.BuildHistoryMessages(messages);

        Assert.Equal(4, llm.Count);
        Assert.Equal("user", llm[0]["role"]?.GetValue<string>());
        Assert.Equal("assistant", llm[1]["role"]?.GetValue<string>());
        Assert.NotNull(llm[1]["tool_calls"]);
        var tc = llm[1]["tool_calls"]![0]!.AsObject();
        Assert.Equal("call_1", tc["id"]?.GetValue<string>());
        Assert.Equal("list_files", tc["function"]?["name"]?.GetValue<string>());
        Assert.Equal("{}", tc["function"]?["arguments"]?.GetValue<string>());
        Assert.Equal("tool", llm[2]["role"]?.GetValue<string>());
        Assert.Equal("call_1", llm[2]["tool_call_id"]?.GetValue<string>());
        Assert.Equal("[\"a.txt\",\"b.txt\"]", llm[2]["content"]?.GetValue<string>());
        Assert.Equal("user", llm[3]["role"]?.GetValue<string>());
    }

    [Fact]
    public void ErrorToolCall_ResultContainsError()
    {
        var messages = new List<AiMessage>
        {
            AssistantWithToolCalls(ErrorCall("call_e", "run_cmd", "{\"cmd\":\"whoami\"}", "permission denied")),
        };

        var llm = AiService.BuildHistoryMessages(messages);

        Assert.Equal(2, llm.Count);
        Assert.Equal("tool", llm[1]["role"]?.GetValue<string>());
        Assert.Equal("call_e", llm[1]["tool_call_id"]?.GetValue<string>());
        Assert.Equal("permission denied", llm[1]["content"]?.GetValue<string>());
    }

    [Fact]
    public void PendingToolCall_IsOmittedFromToolCalls()
    {
        var messages = new List<AiMessage>
        {
            AssistantWithToolCalls(PendingCall("call_p", "request_tier_elevation", "{}")),
            UserMsg("next"),
        };

        var llm = AiService.BuildHistoryMessages(messages);

        Assert.Equal(2, llm.Count);
        Assert.Equal("assistant", llm[0]["role"]?.GetValue<string>());
        Assert.Null(llm[0]["tool_calls"]);
        Assert.Equal("user", llm[1]["role"]?.GetValue<string>());
    }

    [Fact]
    public void MixedToolCalls_OnlyCompletedAreReplayed()
    {
        var messages = new List<AiMessage>
        {
            AssistantWithToolCalls(
                DoneCall("call_ok", "list_files", "{}", "[]"),
                PendingCall("call_pending", "request_tier_elevation", "{}")),
        };

        var llm = AiService.BuildHistoryMessages(messages);

        Assert.Equal(2, llm.Count);
        var tcs = llm[0]["tool_calls"]!.AsArray();
        Assert.Single(tcs);
        Assert.Equal("call_ok", tcs[0]!["id"]?.GetValue<string>());
        Assert.Equal("tool", llm[1]["role"]?.GetValue<string>());
        Assert.Equal("call_ok", llm[1]["tool_call_id"]?.GetValue<string>());
        Assert.Equal("[]", llm[1]["content"]?.GetValue<string>());
    }

    [Fact]
    public void MultipleToolCalls_EveryIdHasResult()
    {
        var messages = new List<AiMessage>
        {
            AssistantWithToolCalls(
                DoneCall("c1", "a", "{}", "r1"),
                DoneCall("c2", "b", "{}", "r2")),
        };

        var llm = AiService.BuildHistoryMessages(messages);

        Assert.Equal(3, llm.Count);
        Assert.Equal("c1", llm[1]["tool_call_id"]?.GetValue<string>());
        Assert.Equal("r1", llm[1]["content"]?.GetValue<string>());
        Assert.Equal("c2", llm[2]["tool_call_id"]?.GetValue<string>());
        Assert.Equal("r2", llm[2]["content"]?.GetValue<string>());
    }

    [Fact]
    public void LegacyStandaloneToolMessage_IsPreserved()
    {
        var messages = new List<AiMessage>
        {
            new()
            {
                Role = "tool",
                ToolCalls = new List<AiToolCall> { DoneCall("legacy", "list_files", "{}", "out") },
            },
        };

        var llm = AiService.BuildHistoryMessages(messages);

        Assert.Single(llm);
        Assert.Equal("tool", llm[0]["role"]?.GetValue<string>());
        Assert.Equal("legacy", llm[0]["tool_call_id"]?.GetValue<string>());
        Assert.Equal("out", llm[0]["content"]?.GetValue<string>());
    }
}
