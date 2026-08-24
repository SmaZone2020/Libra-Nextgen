import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, Card, Input } from '@heroui/react';
import { ChevronDown, CircleXmark } from '@gravity-ui/icons';
import { getProcesses, killProcess } from '../../api/system';
import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import type { DataGridColumn } from '../../components/data-grid';
import type { ProcessItem } from '../../types/models';

const SYSTEM_PROCESS_NAMES = new Set([
  'svchost', 'csrss', 'lsass', 'services', 'smss', 'wininit',
  'conhost', 'RuntimeBroker', 'dllhost', 'sihost', 'fontdrvhost',
  'dwm', 'winlogon', 'LogonUI', 'SearchIndexer', 'WmiPrvSE',
  'spoolsv', 'lsaiso', 'Memory Compression', 'System', 'Idle',
  'Registry', 'dasHost',
]);

function formatMemory(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

interface ProcessGroup {
  name: string;
  processes: ProcessItem[];
  totalCpu: number;
  totalMemory: number;
  isSystem: boolean;
}

interface ProcessTabProps {
  agentId: string;
}

export function ProcessTab({ agentId }: ProcessTabProps) {
  const { t } = useTranslation();
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const hashRef = useRef<string | undefined>(undefined);
  const contextPidRef = useRef<number | null>(null);

  const columns: DataGridColumn<ProcessItem>[] = [
    {
      id: 'pid', header: 'PID',
      cell: (item) => <span className="font-mono text-sm tabular-nums">{item.pid}</span>,
      allowsSorting: true,
      sortFn: (a, b) => a.pid - b.pid,
      isRowHeader: true,
    },
    {
      id: 'cpuMs', header: 'CPU (ms)',
      cell: (item) => <span className="text-default-500 text-sm tabular-nums">{item.cpuMs.toLocaleString()}</span>,
      allowsSorting: true,
      sortFn: (a, b) => a.cpuMs - b.cpuMs,
    },
    {
      id: 'memoryBytes', header: t('agents.ram'),
      cell: (item) => <span className="text-default-500 text-sm tabular-nums">{formatMemory(item.memoryBytes)}</span>,
      allowsSorting: true,
      sortFn: (a, b) => a.memoryBytes - b.memoryBytes,
    },
    {
      id: 'threadCount', header: 'Threads',
      cell: (item) => <span className="text-default-500 text-sm tabular-nums">{item.threadCount}</span>,
      allowsSorting: true,
      sortFn: (a, b) => a.threadCount - b.threadCount,
    },
    {
      id: 'startTime', header: 'Start Time',
      cell: (item) => (
        <span className="text-default-500 text-sm">
          {item.startTime ? new Date(item.startTime).toLocaleString() : '—'}
        </span>
      ),
    },
  ];

  const fetchProcesses = useCallback(async () => {
    try {
      const res = await getProcesses(agentId, hashRef.current);
      if (res.changed && res.processes) {
        setProcesses(res.processes);
        hashRef.current = res.hash;
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => {
    hashRef.current = undefined;
    setLoading(true);
    fetchProcesses();
    const timer = setInterval(fetchProcesses, 8000);
    return () => clearInterval(timer);
  }, [fetchProcesses]);

  const groups = useMemo<ProcessGroup[]>(() => {
    const map = new Map<string, ProcessItem[]>();
    for (const p of processes) {
      const list = map.get(p.name);
      if (list) list.push(p);
      else map.set(p.name, [p]);
    }

    const userGroups: ProcessGroup[] = [];
    const systemProcesses: ProcessItem[] = [];

    for (const [name, procs] of map) {
      if (SYSTEM_PROCESS_NAMES.has(name)) {
        systemProcesses.push(...procs);
      } else {
        userGroups.push({
          name,
          processes: procs,
          totalCpu: procs.reduce((s, p) => s + p.cpuMs, 0),
          totalMemory: procs.reduce((s, p) => s + p.memoryBytes, 0),
          isSystem: false,
        });
      }
    }

    userGroups.sort((a, b) => b.totalMemory - a.totalMemory);

    if (systemProcesses.length > 0) {
      userGroups.push({
        name: t('system.systemProcesses'),
        processes: systemProcesses,
        totalCpu: systemProcesses.reduce((s, p) => s + p.cpuMs, 0),
        totalMemory: systemProcesses.reduce((s, p) => s + p.memoryBytes, 0),
        isSystem: true,
      });
    }

    return userGroups;
  }, [processes, t]);

  const filteredGroups = useMemo(() => {
    if (!filter) return groups;
    const lower = filter.toLowerCase();
    return groups
      .map(g => {
        if (g.name.toLowerCase().includes(lower)) return g;
        const matched = g.processes.filter(
          p => p.name.toLowerCase().includes(lower) || String(p.pid).includes(filter)
        );
        if (matched.length === 0) return null;
        return { ...g, processes: matched, totalCpu: matched.reduce((s, p) => s + p.cpuMs, 0), totalMemory: matched.reduce((s, p) => s + p.memoryBytes, 0) };
      })
      .filter((g): g is ProcessGroup => g !== null);
  }, [groups, filter]);

  const handleContextMenu = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest('[role="row"][data-key]');
    const key = row ? row.getAttribute('data-key') : null;
    contextPidRef.current = key ? Number(key) : null;
  };

  const handleKill = async () => {
    const pid = contextPidRef.current;
    if (pid == null) return;
    await killProcess(agentId, pid);
    hashRef.current = undefined;
    fetchProcesses();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input variant="secondary"
          className="max-w-xs"
          placeholder={t('system.filterProcesses')}
          value={filter}
          onChange={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
        <span className="text-sm text-default-500">{t('system.processesCount', { count: processes.length })}</span>
      </div>
      <Card className="max-h-[calc(100vh-330px)] overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8 text-default-500 text-sm">
            {t('system.loadingProcesses')}
          </div>
        ) : (
          <Accordion
            className="w-full"
          >
            {filteredGroups.map((group) => (
              <Accordion.Item key={group.name} id={group.name}>
                <Accordion.Heading>
                  <Accordion.Trigger>
                    <span className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="font-mono text-sm truncate">{group.name}</span>
                      <span className="text-xs text-default-400">({group.processes.length})</span>
                      <span className="ml-auto flex items-center gap-4 text-xs text-default-500 tabular-nums shrink-0">
                        <span>CPU: {group.totalCpu.toLocaleString()} ms</span>
                        <span>Mem: {formatMemory(group.totalMemory)}</span>
                      </span>
                    </span>
                    <Accordion.Indicator>
                      <ChevronDown />
                    </Accordion.Indicator>
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body>
                    {expandedKeys.has(group.name) ? (
                      <ContextMenu>
                        <ContextMenu.Trigger className="w-full">
                          <div onContextMenu={handleContextMenu}>
                            <DataGrid
                              aria-label={`Processes: ${group.name}`}
                              columns={columns}
                              data={group.processes}
                              getRowId={(p) => p.pid}
                              scrollContainerClassName="max-h-80"
                              renderEmptyState={() => (
                                <div className="flex justify-center py-4 text-default-500 text-sm">
                                  {t('system.noProcesses')}
                                </div>
                              )}
                            />
                          </div>
                        </ContextMenu.Trigger>
                        <ContextMenu.Popover>
                          <ContextMenu.Menu>
                            <ContextMenu.Item id="kill" textValue={t('system.killProcess')} onAction={handleKill}>
                              <CircleXmark className="w-4 h-4" /> {t('system.killProcess')}
                            </ContextMenu.Item>
                          </ContextMenu.Menu>
                        </ContextMenu.Popover>
                      </ContextMenu>
                    ) : null}
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Card>

    </div>
  );
}
