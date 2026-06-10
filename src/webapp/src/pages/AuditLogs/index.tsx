import { useState, useEffect, useCallback } from 'react';
import { getAuditLogs } from '../../api/audit';
import { Widget } from '../../components/widget';
import { DataGrid } from '../../components/data-grid';
import { SearchBar } from './SearchBar';
import { Pagination } from './Pagination';
import type { DataGridColumn } from '../../components/data-grid';
import type { AuditLogEntry } from '../../types/models';

const columns: DataGridColumn<AuditLogEntry>[] = [
  {
    id: 'timestamp', header: 'Time', accessorKey: 'timestamp',
    cell: (item) => <span className="text-sm whitespace-nowrap">{new Date(item.timestamp).toLocaleString()}</span>,
  },
  {
    id: 'userName', header: 'User', accessorKey: 'userName',
    cell: (item) => <span className="text-sm font-medium">{item.userName}</span>,
  },
  {
    id: 'action', header: 'Action', accessorKey: 'action',
    cell: (item) => <span className="font-mono text-sm">{item.action}</span>,
  },
  {
    id: 'targetAgentId', header: 'Target', accessorKey: 'targetAgentId',
    cell: (item) => <span className="font-mono text-xs text-default-500">{item.targetAgentId?.slice(0, 12) ?? '-'}</span>,
  },
  {
    id: 'ipAddress', header: 'IP', accessorKey: 'ipAddress',
    cell: (item) => <span className="font-mono text-sm">{item.ipAddress}</span>,
  },
  {
    id: 'success', header: 'Result', accessorKey: 'success',
    cell: (item) => (
      <span className={`text-sm font-medium ${item.success ? 'text-success' : 'text-danger'}`}>
        {item.success ? 'OK' : 'FAIL'}
      </span>
    ),
  },
];

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const pageSize = 80;

  const fetchLogs = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const res = await getAuditLogs({ page: p, pageSize, query: q || undefined, excludeHeartbeats: true });
      setLogs(res.logs);
      setTotal(res.total);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchLogs(page, search);
  }, [page, search, fetchLogs]);

  const handleSearch = () => {
    setPage(1);
    fetchLogs(1, search);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <Widget>
        <Widget.Header>
          <Widget.Title>Audit Logs</Widget.Title>
        </Widget.Header>
        <Widget.Content>
          <SearchBar
            value={search}
            onChange={setSearch}
            onSearch={handleSearch}
            loading={loading}
          />

          <DataGrid
            aria-label="Audit logs"
            columns={columns}
            data={logs}
            getRowId={(l) => l.id}
            renderEmptyState={() => (
              <div className="flex justify-center py-8 text-default-500 text-sm">
                No audit logs found.
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
        </Widget.Content>
      </Widget>
    </div>
  );
}
