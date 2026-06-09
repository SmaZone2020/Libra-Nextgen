using System.Collections.Concurrent;
using LibraNextgen.Common.Protocol;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Manages exclusive write access to agent PTY sessions.
/// Only one operator can write at a time; others observe read-only.
/// </summary>
public class ShellSessionLock : ISessionLock
{
    private readonly ConcurrentDictionary<string, SessionState> _sessions = new();

    public bool TryAcquireWriteLock(string agentId, string operatorId, out string? currentWriterId)
    {
        var state = _sessions.GetOrAdd(agentId, _ => new SessionState());

        lock (state)
        {
            if (state.WriterId == null)
            {
                state.WriterId = operatorId;
                state.Observers.Remove(operatorId);
                currentWriterId = operatorId;
                return true;
            }

            if (state.WriterId == operatorId)
            {
                currentWriterId = operatorId;
                return true;
            }

            currentWriterId = state.WriterId;
            state.Observers.Add(operatorId);
            return false;
        }
    }

    public void ReleaseWriteLock(string agentId, string operatorId)
    {
        if (!_sessions.TryGetValue(agentId, out var state))
            return;

        lock (state)
        {
            if (state.WriterId == operatorId)
            {
                state.WriterId = null;
            }
        }
    }

    public bool IsWriteLocked(string agentId)
    {
        return _sessions.TryGetValue(agentId, out var state) && state.WriterId != null;
    }

    public string? GetCurrentWriter(string agentId)
    {
        return _sessions.TryGetValue(agentId, out var state) ? state.WriterId : null;
    }

    public IReadOnlySet<string> GetObservers(string agentId)
    {
        return _sessions.TryGetValue(agentId, out var state)
            ? state.Observers
            : new HashSet<string>();
    }

    public void AddObserver(string agentId, string operatorId)
    {
        var state = _sessions.GetOrAdd(agentId, _ => new SessionState());
        lock (state)
        {
            if (state.WriterId != operatorId)
                state.Observers.Add(operatorId);
        }
    }

    public void RemoveObserver(string agentId, string operatorId)
    {
        if (_sessions.TryGetValue(agentId, out var state))
        {
            lock (state) { state.Observers.Remove(operatorId); }
        }
    }

    private class SessionState
    {
        public string? WriterId;
        public HashSet<string> Observers = new();
    }
}
