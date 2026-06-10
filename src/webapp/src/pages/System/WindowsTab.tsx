import { useState, useEffect, useCallback } from 'react';
import { Button } from '@heroui/react';
import { getWindows } from '../../api/system';
import { DataGrid } from '../../components/data-grid';
import type { DataGridColumn } from '../../components/data-grid';
import type { WindowItem } from '../../types/models';

const columns: DataGridColumn<WindowItem>[] = [
  {
    id: 'hwnd', header: 'HWND',
    cell: (item) => <span className="font-mono text-sm tabular-nums">{item.hwnd}</span>,
  },
  {
    id: 'title', header: 'Title',
    cell: (item) => <span className="truncate max-w-[300px]">{item.title}</span>,
  },
  {
    id: 'processName', header: 'Process',
    cell: (item) => <span className="font-mono text-sm">{item.processName}</span>,
  },
  {
    id: 'processId', header: 'PID',
    cell: (item) => <span className="font-mono text-sm tabular-nums">{item.processId}</span>,
  },
  {
    id: 'className', header: 'Class',
    cell: (item) => <span className="text-default-500 text-sm">{item.className}</span>,
  },
];

interface WindowsTabProps {
  agentId: string;
}

export function WindowsTab({ agentId }: WindowsTabProps) {
  const [windows, setWindows] = useState<WindowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);

  const fetchWindows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWindows(agentId);
      setWindows(res.windows);
      setSupported(res.supported);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => {
    fetchWindows();
  }, [fetchWindows]);

  if (!supported) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        Window enumeration is only supported on Windows agents.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onPress={fetchWindows} isDisabled={loading}>
          Refresh
        </Button>
        <span className="text-sm text-default-500">{windows.length} windows</span>
      </div>

      <DataGrid
        aria-label="Window list"
        columns={columns}
        data={windows}
        getRowId={(w) => w.hwnd}
        scrollContainerClassName="max-h-[calc(100vh-300px)]"
        renderEmptyState={() => (
          <div className="flex justify-center py-8 text-default-500 text-sm">
            {loading ? 'Loading windows...' : 'No visible windows found.'}
          </div>
        )}
      />
    </div>
  );
}
