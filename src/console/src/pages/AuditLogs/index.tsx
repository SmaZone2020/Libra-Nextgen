import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, Tabs } from '@heroui/react';
import { getAuditLogs } from '../../api/audit';
import { DataGrid } from '../../components/data-grid';
import { SearchBar } from './SearchBar';
import { Pagination } from './Pagination';
import type { DataGridColumn } from '../../components/data-grid';
import type { AuditLogEntry } from '../../types/models';

export default function AuditLogsPage() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const pageSize = 80;

  const columns: DataGridColumn<AuditLogEntry>[] = [
    {
      id: 'timestamp', header: t('audit.time'), accessorKey: 'timestamp',
      cell: (item) => <span className="text-sm whitespace-nowrap">{new Date(item.timestamp).toLocaleString()}</span>,
    },
    {
      id: 'userName', header: t('audit.user'), accessorKey: 'userName',
      cell: (item) => <span className="text-sm font-medium">{item.userName}</span>,
    },
    {
      id: 'action', header: t('audit.action'), accessorKey: 'action',
      cell: (item) => <span className="font-mono text-sm">{item.action}</span>,
    },
    {
      id: 'risk', header: t('audit.risk'), accessorKey: 'risk',
      cell: (item) => {
        const level = item.risk ?? 'Normal';
        const color = level === 'Safe' ? 'success'
          : level === 'Dangerous' ? 'warning'
          : level === 'Malicious' ? 'danger'
          : 'accent';
        return <Chip size="sm" variant="soft" color={color}>{t(`riskLevel.${level}`)}</Chip>;
      },
    },
    {
      id: 'targetAgentId', header: t('audit.target'), accessorKey: 'targetAgentId',
      cell: (item) => <span className="font-mono text-xs text-default-500">{item.targetAgentId?.slice(0, 12) ?? '-'}</span>,
    },
    {
      id: 'ipAddress', header: t('audit.ip'), accessorKey: 'ipAddress',
      cell: (item) => <span className="font-mono text-sm">{item.ipAddress}</span>,
    },
    {
      id: 'success', header: t('audit.result'), accessorKey: 'success',
      cell: (item) => (
        <span className={`text-sm font-medium ${item.success ? 'text-success' : 'text-danger'}`}>
          {item.success ? t('common.ok') : t('common.fail')}
        </span>
      ),
    },
  ];

  const fetchLogs = useCallback(async (p: number, q: string, r: string) => {
    setLoading(true);
    try {
      const res = await getAuditLogs({
        page: p,
        pageSize,
        query: q || undefined,
        excludeHeartbeats: true,
        risk: r || undefined,
      });
      setLogs(res.logs);
      setTotal(res.total);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchLogs(page, search, riskFilter);
  }, [page, search, riskFilter, fetchLogs]);

  const handleSearch = () => {
    setPage(1);
    fetchLogs(1, search, riskFilter);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SearchBar
        value={search}
        onChange={setSearch}
        onSearch={handleSearch}
        loading={loading}
      />

      <Tabs
        aria-label={t('audit.risk')}
        selectedKey={riskFilter}
        onSelectionChange={(key) => { setRiskFilter(String(key)); setPage(1); }}
      >
        <Tabs.List>
          <Tabs.Tab id="">{t('audit.riskAll')}<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="Safe"><span className="text-green-600">{t('riskLevel.Safe')}</span><Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="Normal"><span className="text-blue-600">{t('riskLevel.Normal')}</span><Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="Dangerous"><span className="text-orange-600">{t('riskLevel.Dangerous')}</span><Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="Malicious"><span className="text-red-600">{t('riskLevel.Malicious')}</span><Tabs.Indicator /></Tabs.Tab>
        </Tabs.List>
      </Tabs>

      <DataGrid
        aria-label={t('audit.title')}
        columns={columns}
        data={logs}
        getRowId={(l) => l.id}
        renderEmptyState={() => (
          <div className="flex justify-center py-8 text-default-500 text-sm">
            {t('audit.noLogs')}
          </div>
        )}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        loading={loading}
        onPageChange={setPage}
      />
    </div>
  );
}
