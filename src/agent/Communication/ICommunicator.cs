using LibraNextgen.Common.Models;

namespace LibraNextgen.Agent.Communication;

public interface ICommunicator
{
    Task<string> RegisterAsync(string hostname, string userName, string os, string arch, string publicKey, CancellationToken ct);
    Task<AgentTask?> HeartbeatAsync(string agentId, CancellationToken ct);
    Task SubmitResultAsync(string agentId, string resultJson, CancellationToken ct);
}
