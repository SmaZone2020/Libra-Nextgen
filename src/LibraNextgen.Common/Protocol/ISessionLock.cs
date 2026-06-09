namespace LibraNextgen.Common.Protocol;

/// <summary>
/// Shell session lock for multi-operator concurrency control.
/// Only one operator can hold write access to an agent's PTY at a time;
/// all other connected operators are read-only observers.
/// </summary>
public interface ISessionLock
{
    bool TryAcquireWriteLock(string agentId, string operatorId, out string? currentWriterId);
    void ReleaseWriteLock(string agentId, string operatorId);
    bool IsWriteLocked(string agentId);
    string? GetCurrentWriter(string agentId);
    IReadOnlySet<string> GetObservers(string agentId);
    void AddObserver(string agentId, string operatorId);
    void RemoveObserver(string agentId, string operatorId);
}
