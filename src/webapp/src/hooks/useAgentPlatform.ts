import { useAgent } from '../contexts/AgentContext';

export type AgentPlatform = 'windows' | 'linux' | 'unknown';

/**
 * Platform of the currently selected agent, inferred from its reported
 * OS version. Used to show/hide platform-specific pages and tabs.
 */
export function useAgentPlatform(): AgentPlatform {
  const { selectedAgent } = useAgent();
  const os = (selectedAgent?.osVersion ?? '').toLowerCase();
  if (!os) return 'unknown';
  return os.includes('linux') ? 'linux' : 'windows';
}
