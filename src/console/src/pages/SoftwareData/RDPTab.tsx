import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Skeleton, Chip, Accordion, Modal, useOverlayState, Tooltip } from '@heroui/react';
import { ArrowRotateLeft, ChevronDown, Copy, Check } from '@gravity-ui/icons';
import { getRDP } from '../../api/othersoft';
import { DataGrid } from '../../components/data-grid';
import type { DataGridColumn } from '../../components/data-grid';
import type { RdpCredentialItem, RdpFileItem, RDPResult } from '../../types/models';

interface RDPTabProps {
  agentId: string;
}

const TYPE_LABELS: Record<string, string> = {
  DomainVisiblePassword: 'cred',
  DomainPassword: 'cred-hash',
};

export function RDPTab({ agentId }: RDPTabProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RDPResult>({ total: 0, items: [], rdpFiles: [] });
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RdpCredentialItem | RdpFileItem | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const modalState = useOverlayState();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getRDP(agentId);
      setData(result);
    } catch {
      setError('Failed to collect RDP credentials.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const copyText = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch { /* ignore */ }
  }, []);

  const credCols = useMemo<DataGridColumn<RdpCredentialItem>[]>(() => [
    {
      id: 'target',
      header: t('othersoft.rdp.target'),
      accessorKey: 'target',
      isRowHeader: true,
      cell: (item) => <span className="font-medium font-mono text-sm">{item.target}</span>,
    },
    {
      id: 'type',
      header: t('othersoft.rdp.type'),
      accessorKey: 'type',
      cell: (item) => (
        <Chip size="sm" variant="soft" color={item.type === 'DomainVisiblePassword' ? 'success' : 'warning'}>
          {TYPE_LABELS[item.type] ?? item.type}
        </Chip>
      ),
    },
    {
      id: 'username',
      header: t('othersoft.rdp.username'),
      accessorKey: 'username',
      cell: (item) => (
        <span className="font-mono text-sm truncate max-w-[240px]" title={item.username}>{item.username}</span>
      ),
    },
    {
      id: 'password',
      header: t('othersoft.rdp.password'),
      accessorKey: 'password',
      cell: (item) => (
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-mono text-sm truncate max-w-[200px]" title={item.password}>
            {item.encrypted ? `[${t('othersoft.rdp.encrypted')}]` : item.password}
          </span>
          {!item.encrypted && item.password && (
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              className="h-7 w-7 min-w-0"
              onPress={() => copyText(item.password, `cred-${item.rawTarget}`)}
            >
              {copiedKey === `cred-${item.rawTarget}` ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>
      ),
    },
  ], [t, copiedKey, copyText]);

  const fileCols = useMemo<DataGridColumn<RdpFileItem>[]>(() => [
    {
      id: 'host',
      header: t('othersoft.rdp.target'),
      accessorKey: 'host',
      isRowHeader: true,
      cell: (item) => <span className="font-medium font-mono text-sm">{item.host || '—'}</span>,
    },
    {
      id: 'username',
      header: t('othersoft.rdp.username'),
      accessorKey: 'username',
      cell: (item) => (
        <span className="font-mono text-sm truncate max-w-[240px]" title={item.username}>{item.username || '—'}</span>
      ),
    },
    {
      id: 'password',
      header: t('othersoft.rdp.password'),
      accessorKey: 'password',
      cell: (item) => (
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-mono text-sm truncate max-w-[200px]" title={item.password}>
            {item.encrypted ? `[${t('othersoft.rdp.encrypted')}]` : item.password}
          </span>
          {!item.encrypted && item.password && (
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              className="h-7 w-7 min-w-0"
              onPress={() => copyText(item.password, `file-${item.path}`)}
            >
              {copiedKey === `file-${item.path}` ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>
      ),
    },
    {
      id: 'path',
      header: t('othersoft.rdp.path'),
      accessorKey: 'path',
      allowsResizing: true,
      minWidth: 200,
      cell: (item) => (
        <span className="font-mono text-xs truncate max-w-[320px] text-default-500" title={item.path}>{item.path}</span>
      ),
    },
  ], [t, copiedKey, copyText]);

  const handleRowAction = useCallback((key: string | number) => {
    const id = String(key);
    const item = [...data.items, ...data.rdpFiles].find(
      (i) => ('rawTarget' in i ? i.rawTarget : i.path) === id,
    );
    if (!item) return;
    setSelected(item);
    modalState.open();
  }, [data, modalState]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    );
  }

  const total = data.items.length + data.rdpFiles.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Chip variant="soft" color="accent">
          {t('othersoft.rdp.itemsFound', { count: total })}
        </Chip>
        <Button size="sm" variant="ghost" onPress={fetchData}>
          <ArrowRotateLeft className="w-4 h-4" />
        </Button>
      </div>
      {error && <div className="text-danger-500 text-sm">{error}</div>}

      {total === 0 ? (
        <div className="text-center text-neutral-500 py-8">{t('othersoft.rdp.noData')}</div>
      ) : (
        <Accordion className="w-full" defaultExpandedKeys={['credentials', 'files']}>
          {data.items.length > 0 && (
            <Accordion.Item key="credentials">
              <Accordion.Heading>
                <Accordion.Trigger>
                  <span className="flex-1 text-left">{t('othersoft.rdp.cat_credentials')}</span>
                  <Chip size="sm" variant="soft" className="mr-2">{data.items.length}</Chip>
                  <Accordion.Indicator><ChevronDown /></Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body>
                  <DataGrid
                    aria-label="RDP credentials"
                    columns={credCols}
                    data={data.items}
                    getRowId={(item) => item.rawTarget}
                    onRowAction={handleRowAction}
                  />
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          )}
          {data.rdpFiles.length > 0 && (
            <Accordion.Item key="files">
              <Accordion.Heading>
                <Accordion.Trigger>
                  <span className="flex-1 text-left">{t('othersoft.rdp.cat_files')}</span>
                  <Chip size="sm" variant="soft" className="mr-2">{data.rdpFiles.length}</Chip>
                  <Accordion.Indicator><ChevronDown /></Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body>
                  <DataGrid
                    aria-label="RDP connection files"
                    columns={fileCols}
                    data={data.rdpFiles}
                    getRowId={(item) => item.path}
                    onRowAction={handleRowAction}
                  />
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          )}
        </Accordion>
      )}

      <Modal state={modalState}>
        <Modal.Backdrop>
          <Modal.Container placement="center">
            <Modal.Dialog className="sm:max-w-[560px]">
              <Modal.CloseTrigger />
              {selected && (
                <>
                  <Modal.Header>
                    <Modal.Heading className="break-all">
                      {'rawTarget' in selected ? selected.rawTarget : selected.host || selected.path}
                    </Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-neutral-500 shrink-0">{t('othersoft.rdp.target')}</span>
                        <span className="font-mono text-xs truncate text-right">
                          {'target' in selected ? selected.target : selected.host || '—'}
                        </span>
                      </div>
                      {'type' in selected && (
                        <div className="flex justify-between gap-4">
                          <span className="text-neutral-500 shrink-0">{t('othersoft.rdp.type')}</span>
                          <Chip size="sm" variant="soft" color={selected.type === 'DomainVisiblePassword' ? 'success' : 'warning'}>
                            {TYPE_LABELS[selected.type] ?? selected.type}
                          </Chip>
                        </div>
                      )}
                      <div className="flex justify-between gap-4">
                        <span className="text-neutral-500 shrink-0">{t('othersoft.rdp.username')}</span>
                        <span className="font-mono text-xs truncate text-right">{selected.username || '—'}</span>
                      </div>
                      {'path' in selected && (
                        <div className="flex justify-between gap-4">
                          <span className="text-neutral-500 shrink-0">{t('othersoft.rdp.path')}</span>
                          <span className="font-mono text-xs truncate text-right">{selected.path}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-4 items-center">
                        <span className="text-neutral-500 shrink-0">{t('othersoft.rdp.password')}</span>
                        {selected.encrypted ? (
                          <Chip size="sm" variant="soft" color="danger">{t('othersoft.rdp.encrypted')}</Chip>
                        ) : (
                          <Tooltip delay={0}>
                            <span className="font-mono text-sm break-all text-right select-all cursor-pointer"
                              onClick={() => copyText(selected.password, 'modal')}>
                              {selected.password || '—'}
                            </span>
                            <Tooltip.Content placement="left">
                              {t('othersoft.rdp.copy')}
                            </Tooltip.Content>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </Modal.Body>
                  {!selected.encrypted && selected.password && (
                    <Modal.Footer>
                      <Button className="flex-1" onPress={() => copyText(selected.password, 'modal')}>
                        <Copy className="w-4 h-4 mr-1" /> {t('othersoft.rdp.copy')}
                      </Button>
                    </Modal.Footer>
                  )}
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
