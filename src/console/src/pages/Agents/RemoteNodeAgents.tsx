'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRightFromSquare, Server } from '@gravity-ui/icons';
import type { AgentListItem } from '../../types/models';
import { getStoredUser } from '../../api/auth';
import { listMeshNodes, meshNodeAgents, type MeshNode } from '../../api/mesh';
import { AgentCard } from './AgentCard';

/** One connected remote node and the agents currently visible on it. */
export interface RemoteAgentSegment {
  nodeId: string;
  nodeName: string;
  origin: string;
  storageType?: 'sqlite' | 'mongo' | null;
  agents: AgentListItem[];
}

const REFRESH_MS = 15000;
const STORE_LABEL: Record<string, string> = { sqlite: 'SQLite', mongo: 'MongoDB' };

/**
 * Poll connected mesh nodes and pull each one's agent list through the hub
 * proxy. Read-only by design (v1): interacting with a remote agent happens in
 * that node's own console. Empty when the current user is not an admin or no
 * node is connected.
 */
export function useRemoteAgentSegments(): RemoteAgentSegment[] {
  const isAdmin = getStoredUser()?.role === 'Admin';
  const [segments, setSegments] = useState<RemoteAgentSegment[]>([]);
  const [nodes, setNodes] = useState<MeshNode[]>([]);

  const loadNodes = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setNodes(await listMeshNodes());
    } catch {
      /* transient mesh outage — keep the last known node set */
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setSegments([]);
      setNodes([]);
      return;
    }
    void loadNodes();
    const timer = setInterval(loadNodes, REFRESH_MS);
    return () => clearInterval(timer);
  }, [isAdmin, loadNodes]);

  const connectedNodes = useMemo(() => nodes.filter((n) => n.connected), [nodes]);

  // Pull agent lists whenever the connected-node set changes; a failing node
  // is dropped silently for that round and reappears once it responds again.
  useEffect(() => {
    if (!isAdmin || connectedNodes.length === 0) {
      setSegments([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled(
        connectedNodes.map(async (n): Promise<RemoteAgentSegment> => {
          const res = await meshNodeAgents(n.id, 1, 100);
          return {
            nodeId: n.id,
            nodeName: n.name,
            origin: n.origin,
            storageType: n.storageType ?? null,
            agents: res.agents,
          };
        }),
      );
      if (cancelled) return;
      setSegments(
        results
          .filter((r): r is PromiseFulfilledResult<RemoteAgentSegment> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((s) => s.agents.length > 0),
      );
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAdmin, connectedNodes]);

  return segments;
}

/**
 * Read-only aggregate view of agents running on connected remote nodes,
 * rendered as node-segmented sections below the local device list.
 */
export function RemoteNodeAgents() {
  const { t } = useTranslation();
  const segments = useRemoteAgentSegments();

  if (segments.length === 0) return null;

  return (
    <div className="mt-6 space-y-5 border-t border-neutral-200/70 pt-5 dark:border-neutral-800">
      <div>
        <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          {t('agents.remoteTitle')}
        </h2>
        <p className="mt-0.5 text-xs text-default-400">{t('agents.remoteHint')}</p>
      </div>

      {segments.map((seg) => (
        <section key={seg.nodeId}>
          <div className="mb-2 flex items-center gap-2">
            <Server className="size-4 shrink-0 text-neutral-500" />
            <span className="truncate text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">
              {seg.nodeName}
            </span>
            {seg.storageType && (
              <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-soft-foreground">
                {STORE_LABEL[seg.storageType]}
              </span>
            )}
            <span className="shrink-0 text-xs text-neutral-400">
              {t('agents.nodeAgentsCount', { count: seg.agents.length })}
            </span>
            <a
              href={seg.origin}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              {t('agents.openNodeConsole')}
              <ArrowUpRightFromSquare className="size-3" />
            </a>
          </div>

          <div className="space-y-2.5">
            {seg.agents.map((agent) => (
              <AgentCard
                key={`${seg.nodeId}:${agent.id}`}
                agent={agent}
                connected={false}
                onOpen={() => window.open(seg.origin, '_blank', 'noopener')}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
