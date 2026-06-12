import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Skeleton, Chip, Accordion } from '@heroui/react';
import { ArrowRotateLeft, ChevronDown, Eye, EyeSlash } from '@gravity-ui/icons';
import { getAI } from '../../api/othersoft';
import { DataGrid } from '../../components/data-grid/data-grid';
import type { DataGridColumn } from '../../components/data-grid';
import type { AITokenEntry } from '../../types/models';

interface AITabProps {
  agentId: string;
}

interface VendorGroup {
  vendor: string;
  icon: string;
  items: AITokenEntry[];
}

const VENDOR_META: Record<string, { icon: string; label: string }> = {
  ClaudeCode: { icon: '/icon/claude.svg', label: 'Claude Code' },
  OpenCode: { icon: '/icon/opencode-logo-light.svg', label: 'OpenCode' },
  CodeX: { icon: '/icon/openai.svg', label: 'CodeX' },
  Gemini: { icon: '/icon/gemini.svg', label: 'Gemini' },
  OpenClaw: { icon: '/icon/claw.svg', label: 'OpenClaw' },
  HermesAgent: { icon: '/icon/hermes.png', label: 'Hermes Agent' },
};

function maskKey(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

const COLS: DataGridColumn<AITokenEntry>[] = [
  {
    id: 'source',
    header: '',
    accessorKey: 'source',
    allowsSorting: true,
    cell: (item: AITokenEntry) => (
      <Chip size="sm" variant="soft" color={item.source === 'config-file' ? 'accent' : 'warning'}>
        {item.source === 'config-file' ? 'Config' : 'Env'}
      </Chip>
    ),
  },
  {
    id: 'path',
    header: '',
    accessorKey: 'path',
    allowsResizing: true,
    minWidth: 200,
    cell: (item: AITokenEntry) => (
      <span className="font-mono text-xs truncate max-w-[400px]" title={item.path}>{item.path}</span>
    ),
  },
  {
    id: 'keyName',
    header: '',
    accessorKey: 'keyName',
    allowsSorting: true,
    isRowHeader: true,
  },
  {
    id: 'keyValue',
    header: '',
    accessorKey: 'keyValue',
    cell: (item: AITokenEntry) => (
      <span className="font-mono text-xs" title={maskKey(item.keyValue)}>{maskKey(item.keyValue)}</span>
    ),
  },
];

export function AITab({ agentId }: AITabProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AITokenEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAI(agentId);
      setData(result.items ?? []);
    } catch {
      setError('Failed to scan AI tokens.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const groups = useMemo<VendorGroup[]>(() => {
    const map = new Map<string, AITokenEntry[]>();
    for (const item of data) {
      const list = map.get(item.vendor) ?? [];
      list.push(item);
      map.set(item.vendor, list);
    }
    return [...map.entries()].map(([vendor, items]) => ({
      vendor,
      icon: VENDOR_META[vendor]?.icon ?? '/icon/openai.svg',
      items,
    }));
  }, [data]);

  const cols = useMemo(() => COLS.map(c => {
    const base = {
      ...c,
      header: t(`othersoft.ai.${c.id === 'source' ? 'source' : c.id === 'path' ? 'path' : c.id === 'keyName' ? 'key' : 'key'}`),
    };
    if (c.id === 'keyValue') {
      base.cell = (item: AITokenEntry) => (
        <span className="font-mono text-xs" title={showRaw ? item.keyValue : maskKey(item.keyValue)}>
          {showRaw ? item.keyValue : maskKey(item.keyValue)}
        </span>
      );
    }
    return base;
  }), [t, showRaw]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Chip variant="soft" color="accent">
          {t('othersoft.ai.itemsFound', { count: data.length })}
        </Chip>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onPress={() => setShowRaw(s => !s)}>
            {showRaw ? <EyeSlash className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
          <Button size="sm" variant="ghost" onPress={fetchData}>
            <ArrowRotateLeft className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {error && <div className="text-danger-500 text-sm">{error}</div>}

      {groups.length === 0 ? (
        <div className="text-center text-neutral-500 py-8">{t('othersoft.ai.noData')}</div>
      ) : (
        <Accordion className="w-full">
          {groups.map(g => (
            <Accordion.Item key={g.vendor}>
              <Accordion.Heading>
                <Accordion.Trigger>
                  <img src={g.icon} alt={g.vendor} className="mr-3 size-5 shrink-0" />
                  <span className="flex-1 text-left">{VENDOR_META[g.vendor]?.label ?? g.vendor}</span>
                  <Chip size="sm" variant="soft" className="mr-2">{g.items.length}</Chip>
                  <Accordion.Indicator><ChevronDown /></Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body>
                  <DataGrid
                    aria-label={`${g.vendor} tokens`}
                    columns={cols}
                    data={g.items}
                    getRowId={(item) => `${item.vendor}:${item.path}:${item.keyName}:${item.keyValue}`}
                  />
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </div>
  );
}
