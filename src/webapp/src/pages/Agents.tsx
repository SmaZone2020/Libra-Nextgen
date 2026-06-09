import { useState, useEffect } from 'react';
import { getAgents, getAgent, deleteAgent } from '../api/agents';
import type { AgentListItem, AgentDetail } from '../types/models';

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selected, setSelected] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAgents();
    const timer = setInterval(loadAgents, 10000);
    return () => clearInterval(timer);
  }, []);

  async function loadAgents() {
    try {
      const res = await getAgents(1, 100);
      setAgents(res.agents);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function selectAgent(id: string) {
    try {
      const detail = await getAgent(id);
      setSelected(detail);
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this agent?')) return;
    await deleteAgent(id);
    setSelected(null);
    loadAgents();
  }

  const statusColor = (s: string) =>
    s === 'Online' ? 'bg-emerald-900/50 text-emerald-400' :
    s === 'Offline' ? 'bg-zinc-800 text-zinc-500' :
    'bg-amber-900/50 text-amber-400';

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Agents</h1>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {loading ? (
            <p className="p-4 text-zinc-500">Loading...</p>
          ) : agents.length === 0 ? (
            <p className="p-4 text-zinc-500">No agents connected.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="text-left py-3 px-4">Hostname</th>
                  <th className="text-left py-3 px-4">IP</th>
                  <th className="text-left py-3 px-4">OS</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(a => (
                  <tr
                    key={a.id}
                    onClick={() => selectAgent(a.id)}
                    className={`border-b border-zinc-800/50 cursor-pointer hover:bg-zinc-800/50 transition-colors ${
                      selected?.id === a.id ? 'bg-zinc-800' : ''
                    }`}
                  >
                    <td className="py-3 px-4 font-mono text-white">{a.hostname}</td>
                    <td className="py-3 px-4 font-mono text-zinc-400">{a.ipAddress}</td>
                    <td className="py-3 px-4 text-zinc-400">{a.osVersion}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(a.status)}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-500">{new Date(a.lastSeen).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          {selected ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold text-white">{selected.hostname}</h2>
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
              <div className="space-y-1 text-sm">
                {[
                  ['IP', selected.ipAddress],
                  ['OS', selected.osVersion],
                  ['Arch', selected.arch],
                  ['User', selected.userName],
                  ['Process', `${selected.processName} (PID ${selected.pid})`],
                  ['Elevated', selected.isElevated ? 'Yes' : 'No'],
                  ['First Seen', new Date(selected.firstSeen).toLocaleString()],
                  ['Heartbeat', `${selected.heartbeatInterval}s`],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-zinc-500">{label}</span>
                    <span className="text-zinc-300">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-zinc-500 text-sm">Select an agent to view details.</p>
          )}
        </div>
      </div>
    </div>
  );
}
