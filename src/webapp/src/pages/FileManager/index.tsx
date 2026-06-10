import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button, Chip, ComboBox, Input, Label, ListBox } from '@heroui/react';
import { getAgents } from '../../api/agents';
import { listFiles, getDrives } from '../../api/files';
import type { FileEntry } from '../../api/files';
import { PathBar } from './PathBar';
import { FileList } from './FileList';
import type { AgentListItem } from '../../types/models';

export default function FileManagerPage() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [path, setPath] = useState('C:\\');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const contextRef = useRef<FileEntry | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await getAgents(1, 100, 'online');
        if (!cancelled) setAgents(res.agents);
      } catch { /* ignore */ }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const sendFileList = useCallback(async (dirPath: string) => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listFiles(agentId, dirPath);
      setPath(result.path);
      setEntries(result.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to list directory');
    } finally { setLoading(false); }
  }, [agentId]);

  const bindAgent = useCallback(async (id: string) => {
    if (!id) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setAgentId(id);
    setConnected(true);
    setEntries([]);
    setPath('C:\\');
    setHistory([]);
    setLoading(true);

    try {
      const [fileResult, drivesResult] = await Promise.all([
        listFiles(id, 'C:\\'),
        getDrives(id),
      ]);
      setPath(fileResult.path);
      setEntries(fileResult.entries);
      setDrives(drivesResult.drives);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect to agent');
      setConnected(false);
    } finally { setLoading(false); }
  }, []);

  const sortedEntries = useMemo(() => {
    const sorted = [...entries];
    sorted.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return sorted;
  }, [entries]);

  const navigateTo = useCallback((dirPath: string) => {
    setHistory(prev => [...prev, path]);
    sendFileList(dirPath);
  }, [path, sendFileList]);

  const handleRowAction = useCallback((key: string | number) => {
    const entry = entries.find(e => e.name === String(key));
    if (entry?.type === 'dir') {
      const newPath = path.replace(/\\+$/, '') + '\\' + entry.name;
      navigateTo(newPath);
    }
  }, [entries, path, navigateTo]);

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1]!;
    setHistory(h => h.slice(0, -1));
    sendFileList(prev);
  }, [history, sendFileList]);

  const goUp = useCallback(() => {
    const parent = path.split('\\').slice(0, -1).join('\\') || path[0] + ':\\';
    navigateTo(parent);
  }, [path, navigateTo]);

  const handleDriveChange = useCallback((drive: string) => {
    setHistory(prev => [...prev, path]);
    sendFileList(drive);
  }, [path, sendFileList]);

  const handleContextMenu = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest('[role="row"][data-key]');
    const key = row ? row.getAttribute('data-key') : null;
    contextRef.current = entries.find(en => en.name === key) ?? null;
  };

  const handleDisconnect = useCallback(() => {
    abortRef.current?.abort();
    setConnected(false);
    setAgentId('');
    setEntries([]);
    setHistory([]);
  }, []);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const selectedAgent = agents.find(a => a.id === agentId);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <ComboBox
          defaultItems={agents}
          selectedKey={agentId || null}
          onSelectionChange={(key) => bindAgent(String(key))}
          isDisabled={connected}
        >
          <Label>Agent</Label>
          <ComboBox.InputGroup>
            <Input placeholder="Select agent..." />
            <ComboBox.Trigger />
          </ComboBox.InputGroup>
          <ComboBox.Popover>
            <ListBox>
              {(item: AgentListItem) => (
                <ListBox.Item id={item.id} textValue={item.hostname}>
                  {item.hostname}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              )}
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>

        {connected && selectedAgent && (
          <div className="flex items-center gap-2">
            <Chip size="sm" variant="soft" color="success">{selectedAgent.hostname}</Chip>
            <Chip size="sm" variant="soft">{selectedAgent.ipAddress}</Chip>
          </div>
        )}

        {connected && (
          <Button size="sm" variant="ghost" onPress={handleDisconnect}>
            Disconnect
          </Button>
        )}
      </div>

      {connected && (
        <PathBar
          path={path}
          drives={drives}
          historyLength={history.length}
          onGoBack={goBack}
          onGoUp={goUp}
          onDriveChange={handleDriveChange}
          onNavigate={navigateTo}
        />
      )}

      {connected && (
        <FileList
          entries={sortedEntries}
          loading={loading}
          error={error}
          onRowAction={handleRowAction}
          onContextMenu={handleContextMenu}
        />
      )}

      {!connected && (
        <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
          Select an online agent to browse its file system.
        </div>
      )}
    </div>
  );
}
