import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';
import {
  CircleXmark, ArrowUp, ArrowDown, Xmark,
  ArrowDownToLine, ArrowUpFromLine, Pencil,
} from '@gravity-ui/icons';
import { getWindows, killProcess, closeWindow, minimizeWindow, maximizeWindow, setWindowTopmost, setWindowBottom, setWindowTitle } from '../../api/system';
import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import { useDialog } from '../../hooks/useDialog';
import type { DataGridColumn } from '../../components/data-grid';
import type { WindowItem } from '../../types/models';

interface WindowsTabProps {
  agentId: string;
}

export function WindowsTab({ agentId }: WindowsTabProps) {
  const { t } = useTranslation();
  const [windows, setWindows] = useState<WindowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const contextRef = useRef<WindowItem | null>(null);
  const { prompt, DialogComponent } = useDialog();

  const columns: DataGridColumn<WindowItem>[] = [
    {
      id: 'hwnd', header: 'HWND',
      cell: (item) => <span className="font-mono text-sm tabular-nums">{item.hwnd}</span>,
      isRowHeader: true,
    },
    {
      id: 'title', header: 'Title',
      cell: (item) => <span className="truncate max-w-[300px]">{item.title}</span>,
    },
    {
      id: 'processName', header: t('agents.process'),
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

  const handleContextMenu = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest('[role="row"][data-key]');
    const key = row ? row.getAttribute('data-key') : null;
    contextRef.current = key ? windows.find(w => String(w.hwnd) === key) ?? null : null;
  };

  const handleKillProcess = async () => {
    const w = contextRef.current;
    if (!w) return;
    await killProcess(agentId, w.processId);
    fetchWindows();
  };

  const handleClose = async () => {
    const w = contextRef.current;
    if (!w) return;
    await closeWindow(agentId, w.hwnd);
    setTimeout(fetchWindows, 500);
  };

  const handleMinimize = async () => {
    const w = contextRef.current;
    if (!w) return;
    await minimizeWindow(agentId, w.hwnd);
  };

  const handleMaximize = async () => {
    const w = contextRef.current;
    if (!w) return;
    await maximizeWindow(agentId, w.hwnd);
  };

  const handleTopmost = async () => {
    const w = contextRef.current;
    if (!w) return;
    await setWindowTopmost(agentId, w.hwnd);
  };

  const handleBottom = async () => {
    const w = contextRef.current;
    if (!w) return;
    await setWindowBottom(agentId, w.hwnd);
  };

  const handleSetTitle = async () => {
    const w = contextRef.current;
    if (!w) return;
    const { confirmed, value } = await prompt(t('system.newTitlePrompt'), w.title);
    if (!confirmed || !value || value === w.title) return;
    await setWindowTitle(agentId, w.hwnd, value);
    fetchWindows();
  };

  if (!supported) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500 text-sm select-none">
        {t('system.windowsAgentOnly')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="tertiary" onPress={fetchWindows} isDisabled={loading}>
          {t('common.refresh')}
        </Button>
        <span className="text-sm text-default-500">{t('system.windowsCount', { count: windows.length })}</span>
      </div>

      <ContextMenu>
        <ContextMenu.Trigger className="w-full">
          <div onContextMenu={handleContextMenu}>
            <DataGrid
              aria-label="Window list"
              columns={columns}
              data={windows}
              getRowId={(w) => w.hwnd}
              scrollContainerClassName="max-h-[calc(100vh-300px)]"
              renderEmptyState={() => (
                <div className="flex justify-center py-8 text-default-500 text-sm">
                  {loading ? t('system.loadingWindows') : t('system.noWindows')}
                </div>
              )}
            />
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Popover>
          <ContextMenu.Menu>
            <ContextMenu.Item id="kill" textValue={t('system.killProcess')} onAction={handleKillProcess}>
              <CircleXmark className="w-4 h-4" /> {t('system.killProcess')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item id="topmost" textValue={t('system.setTopmost')} onAction={handleTopmost}>
              <ArrowUp className="w-4 h-4" /> {t('system.setTopmost')}
            </ContextMenu.Item>
            <ContextMenu.Item id="bottom" textValue={t('system.setBottom')} onAction={handleBottom}>
              <ArrowDown className="w-4 h-4" /> {t('system.setBottom')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item id="close" textValue={t('common.close')} onAction={handleClose}>
              <Xmark className="w-4 h-4" /> {t('common.close')}
            </ContextMenu.Item>
            <ContextMenu.Item id="minimize" textValue={t('system.minimize')} onAction={handleMinimize}>
              <ArrowDownToLine className="w-4 h-4" /> {t('system.minimize')}
            </ContextMenu.Item>
            <ContextMenu.Item id="maximize" textValue={t('system.maximize')} onAction={handleMaximize}>
              <ArrowUpFromLine className="w-4 h-4" /> {t('system.maximize')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item id="settitle" textValue={t('system.changeTitle')} onAction={handleSetTitle}>
              <Pencil className="w-4 h-4" /> {t('system.changeTitle')}
            </ContextMenu.Item>
          </ContextMenu.Menu>
        </ContextMenu.Popover>
      </ContextMenu>

      {DialogComponent}
    </div>
  );
}
