import { useState, useEffect } from 'react';
import { getAgents } from '../api/agents';
import { getTasks } from '../api/tasks';
import type { AgentListItem } from '../types/models';

export default function Dashboard() {
  const [stats, setStats] = useState({ agents: 0, online: 0, tasks: 0, pending: 0 });
  const [recentAgents, setRecentAgents] = useState<AgentListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [agentRes, taskRes] = await Promise.all([
          getAgents(1, 5),
          getTasks(undefined, undefined, 1, 5),
        ]);
        if (!cancelled) {
          setStats({
            agents: agentRes.total,
            online: agentRes.online,
            tasks: taskRes.total,
            pending: 0,
          });
          setRecentAgents(agentRes.agents);
        }
      } catch { /* ignore */ }
    }
    load();
    const timer = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const cards = [
    { label: 'Total Agents', value: stats.agents, color: 'text-blue-400' },
    { label: 'Online', value: stats.online, color: 'text-emerald-400' },
    { label: 'Total Tasks', value: stats.tasks, color: 'text-amber-400' },
    { label: 'Pending', value: stats.pending, color: 'text-purple-400' },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      <div className="grid grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-sm text-zinc-500">{c.label}</p>
            <p className={`text-3xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-white mb-3">Recent Agents</h2>
        {recentAgents.length === 0 ? (
          <p className="text-zinc-500 text-sm">No agents connected yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="text-left py-2">Hostname</th>
                <th className="text-left py-2">IP</th>
                <th className="text-left py-2">OS</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {recentAgents.map(a => (
                <tr key={a.id} className="border-b border-zinc-800/50 text-zinc-300">
                  <td className="py-2 font-mono">{a.hostname}</td>
                  <td className="py-2 font-mono">{a.ipAddress}</td>
                  <td className="py-2">{a.osVersion}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      a.status === 'Online' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="py-2 text-zinc-500">{new Date(a.lastSeen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
