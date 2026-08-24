import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, TextField, Input, Skeleton } from '@heroui/react';
import { ArrowRotateLeft } from '@gravity-ui/icons';
import { getPackages } from '../../api/system';
import { DataGrid } from '../../components/data-grid';
import type { DataGridColumn } from '../../components/data-grid';
import type { PackageItem, PackagesResult } from '../../types/models';

interface PackagesTabProps {
  agentId: string;
}

const PM_LABEL: Record<string, string> = {
  dpkg: 'dpkg (Debian/Ubuntu)',
  rpm: 'rpm (RHEL/Fedora)',
  pacman: 'pacman (Arch)',
  apk: 'apk (Alpine)',
  registry: 'registry (Windows)',
};

export function PackagesTab({ agentId }: PackagesTabProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<PackagesResult>({ pm: '', total: 0, packages: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPackages(agentId);
      setData(res);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!filter) return data.packages;
    const q = filter.toLowerCase();
    return data.packages.filter(p => p.name.toLowerCase().includes(q) || p.version.toLowerCase().includes(q));
  }, [data.packages, filter]);

  const columns = useMemo<DataGridColumn<PackageItem>[]>(() => [
    {
      id: 'name',
      header: t('system.packages.name'),
      accessorKey: 'name',
      isRowHeader: true,
      cell: (item) => <span className="font-medium text-sm">{item.name}</span>,
    },
    {
      id: 'version',
      header: t('system.packages.version'),
      accessorKey: 'version',
      cell: (item) => <span className="font-mono text-xs text-default-500">{item.version || '—'}</span>,
    },
    {
      id: 'arch',
      header: t('system.packages.arch'),
      accessorKey: 'arch',
      cell: (item) => item.arch ? <span className="font-mono text-xs">{item.arch}</span> : <span className="text-default-400">—</span>,
    },
    {
      id: 'manager',
      header: t('system.packages.manager'),
      accessorKey: 'manager',
      cell: (item) => <Chip size="sm" variant="soft">{item.manager}</Chip>,
    },
  ], [t]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Chip variant="soft" color="accent">
            {t('system.packages.itemsFound', { count: data.total })}
          </Chip>
          {data.pm && <Chip variant="soft">{PM_LABEL[data.pm] ?? data.pm}</Chip>}
        </div>
        <div className="flex items-center gap-2">
          <TextField
            variant="secondary"
            aria-label={t('system.packages.search')}
            value={filter}
            onChange={setFilter}
            className="w-56"
          >
            <Input placeholder={t('system.packages.search')} />
          </TextField>
          <Button size="sm" variant="ghost" isIconOnly onPress={fetchData}>
            <ArrowRotateLeft className="w-4 h-4" />
          </Button>
        </div>
      </div>
      {data.error && <div className="text-danger-500 text-sm">{data.error}</div>}
      {filtered.length === 0 ? (
        <div className="text-center text-neutral-500 py-8">{t('system.packages.noData')}</div>
      ) : (
        <DataGrid
          aria-label={t('system.packages.title')}
          columns={columns}
          data={filtered}
          getRowId={(item) => `${item.manager}:${item.name}`}
        />
      )}
    </div>
  );
}
