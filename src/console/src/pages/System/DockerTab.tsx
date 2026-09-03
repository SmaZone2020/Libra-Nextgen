import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, Skeleton } from '@heroui/react';
import { ArrowRotateLeft } from '@gravity-ui/icons';
import { getDocker } from '../../api/system';
import { DataGrid } from '../../components/data-grid';
import type { DataGridColumn } from '../../components/data-grid';
import type { DockerContainer, DockerResult } from '../../types/models';

interface DockerTabProps {
  agentId: string;
}

export function DockerTab({ agentId }: DockerTabProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<DockerResult>({ inContainer: false, socketPresent: false, cliAvailable: false, total: 0, containers: [] });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDocker(agentId);
      setData(res);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns = useMemo<DataGridColumn<DockerContainer>[]>(() => [
    {
      id: 'id',
      header: 'ID',
      accessorKey: 'id',
      isRowHeader: true,
      cell: (item) => <span className="font-mono text-xs">{item.id.slice(0, 12)}</span>,
    },
    {
      id: 'name',
      header: t('system.docker.name'),
      accessorKey: 'name',
      cell: (item) => <span className="font-medium text-sm">{item.name || '—'}</span>,
    },
    {
      id: 'image',
      header: t('system.docker.image'),
      accessorKey: 'image',
      cell: (item) => <span className="font-mono text-xs">{item.image || '—'}</span>,
    },
    {
      id: 'status',
      header: t('system.docker.status'),
      accessorKey: 'status',
      cell: (item) => <span className="text-xs">{item.status || '—'}</span>,
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
        <div className="flex items-center gap-2 flex-wrap">
          <Chip variant="soft" color={data.inContainer ? 'warning' : 'default'}>
            {data.inContainer ? t('system.docker.inContainer') : t('system.docker.notInContainer')}
          </Chip>
          <Chip variant="soft" color={data.socketPresent ? 'success' : 'danger'}>
            {t('system.docker.socket')}: {data.socketPresent ? t('common.yes') : t('common.no')}
          </Chip>
          <Chip variant="soft" color={data.cliAvailable ? 'success' : 'danger'}>
            CLI: {data.cliAvailable ? t('common.yes') : t('common.no')}
          </Chip>
          <Chip variant="soft" color="accent">
            {t('system.docker.itemsFound', { count: data.total })}
          </Chip>
        </div>
        <Button size="sm" variant="ghost" isIconOnly onPress={fetchData}>
          <ArrowRotateLeft className="w-4 h-4" />
        </Button>
      </div>

      {data.containers.length === 0 ? (
        <div className="text-center text-neutral-500 py-8">
          {data.cliAvailable ? t('system.docker.noContainers') : t('system.docker.noCli')}
        </div>
      ) : (
        <DataGrid
          aria-label={t('system.docker.title')}
          columns={columns}
          data={data.containers}
          getRowId={(item) => item.id}
        />
      )}
    </div>
  );
}
