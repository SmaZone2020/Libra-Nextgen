import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Skeleton, Chip, Accordion, Modal, useOverlayState } from '@heroui/react';
import { ArrowRotateLeft, ArrowDownToLine, ChevronDown, Copy } from '@gravity-ui/icons';
import { getSSH } from '../../api/othersoft';
import { DataGrid } from '../../components/data-grid';
import type { DataGridColumn } from '../../components/data-grid';
import type { SshKeyCategory, SshKeyItem } from '../../types/models';

interface SSHTabProps {
  agentId: string;
}

const CATEGORY_ORDER: SshKeyCategory[] = [
  'private-key',
  'public-key',
  'authorized-keys',
  'known-hosts',
  'config',
  'other',
];

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const maskPreview = (content: string): string => {
  if (!content) return '';
  const firstLine = content.split('\n')[0] ?? '';
  return firstLine.length > 64 ? `${firstLine.slice(0, 64)}…` : firstLine;
};

export function SSHTab({ agentId }: SSHTabProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [sshDir, setSshDir] = useState('');
  const [data, setData] = useState<SshKeyItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SshKeyItem | null>(null);
  const modalState = useOverlayState();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSSH(agentId);
      setSshDir(result.sshDir ?? '');
      setData(result.items ?? []);
    } catch {
      setError('Failed to scan SSH keys.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const groups = useMemo(() => {
    return CATEGORY_ORDER
      .map((cat) => ({ cat, items: data.filter((i) => i.category === cat) }))
      .filter((g) => g.items.length > 0);
  }, [data]);

  const cols = useMemo<DataGridColumn<SshKeyItem>[]>(() => [
    {
      id: 'name',
      header: t('othersoft.ssh.name'),
      accessorKey: 'name',
      isRowHeader: true,
      cell: (item) => <span className="font-medium">{item.name}</span>,
    },
    {
      id: 'encrypted',
      header: t('othersoft.ssh.encrypted'),
      accessorKey: 'encrypted',
      cell: (item) =>
        item.encrypted ? (
          <Chip size="sm" variant="soft" color="danger">{t('othersoft.ssh.encrypted')}</Chip>
        ) : null,
    },
    {
      id: 'path',
      header: t('othersoft.ssh.path'),
      accessorKey: 'path',
      allowsResizing: true,
      minWidth: 200,
      cell: (item) => (
        <span className="font-mono text-xs truncate max-w-[360px]" title={item.path}>{item.path}</span>
      ),
    },
    {
      id: 'size',
      header: t('othersoft.ssh.size'),
      accessorKey: 'size',
      cell: (item) => (
        <span className="text-default-500 text-sm tabular-nums">{formatSize(item.size)}</span>
      ),
    },
    {
      id: 'preview',
      header: t('othersoft.ssh.content'),
      cell: (item) => (
        <span className="font-mono text-xs text-default-500 truncate max-w-[260px]">
          {maskPreview(item.content)}
        </span>
      ),
    },
  ], [t]);

  const handleRowAction = useCallback((key: string | number) => {
    const item = data.find((i) => i.path === String(key));
    if (!item) return;
    setSelected(item);
    modalState.open();
  }, [data, modalState]);

  const handleCopy = useCallback(async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.content); } catch { /* ignore */ }
  }, [selected]);

  const handleDownload = useCallback(() => {
    if (!selected) return;
    const blob = new Blob([selected.content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selected.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [selected]);

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
      <div className="flex items-center justify-between">
        <Chip variant="soft" color="accent">
          {t('othersoft.ssh.itemsFound', { count: data.length })}
        </Chip>
        <Button size="sm" variant="ghost" onPress={fetchData}>
          <ArrowRotateLeft className="w-4 h-4" />
        </Button>
      </div>

      {sshDir && (
        <div className="font-mono text-xs text-default-500 truncate" title={sshDir}>{sshDir}</div>
      )}
      {error && <div className="text-danger-500 text-sm">{error}</div>}

      {groups.length === 0 ? (
        <div className="text-center text-neutral-500 py-8">{t('othersoft.ssh.noData')}</div>
      ) : (
        <Accordion className="w-full">
          {groups.map((g) => (
            <Accordion.Item key={g.cat}>
              <Accordion.Heading>
                <Accordion.Trigger>
                  <span className="flex-1 text-left">{t(`othersoft.ssh.cat_${g.cat}`)}</span>
                  <Chip size="sm" variant="soft" className="mr-2">{g.items.length}</Chip>
                  <Accordion.Indicator><ChevronDown /></Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body>
                  <DataGrid
                    aria-label={`${g.cat} keys`}
                    columns={cols}
                    data={g.items}
                    getRowId={(item) => item.path}
                    onRowAction={handleRowAction}
                  />
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}

      <Modal state={modalState}>
        <Modal.Backdrop>
          <Modal.Container placement="center">
            <Modal.Dialog className="sm:max-w-[640px]">
              <Modal.CloseTrigger />
              {selected && (
                <>
                  <Modal.Header>
                    <Modal.Heading className="break-all">{selected.name}</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <div className="space-y-2 text-sm mb-3">
                      <div className="flex justify-between gap-4">
                        <span className="text-neutral-500 shrink-0">{t('othersoft.ssh.path')}</span>
                        <span className="font-mono text-xs truncate text-right">{selected.path}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-neutral-500 shrink-0">{t('othersoft.ssh.size')}</span>
                        <span>{formatSize(selected.size)}</span>
                      </div>
                      {selected.encrypted && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-neutral-500 shrink-0">{t('othersoft.ssh.encrypted')}</span>
                          <Chip size="sm" variant="soft" color="danger">{t('othersoft.ssh.encrypted')}</Chip>
                        </div>
                      )}
                    </div>
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-[50vh] overflow-auto bg-default-100 rounded p-3">
                      {selected.content}
                    </pre>
                  </Modal.Body>
                  <Modal.Footer>
                    <Button variant="ghost" onPress={handleCopy} className="flex-1">
                      <Copy className="w-4 h-4 mr-1" /> {t('othersoft.ssh.copy')}
                    </Button>
                    <Button className="flex-1" onPress={handleDownload}>
                      <ArrowDownToLine className="w-4 h-4 mr-1" /> {t('othersoft.download')}
                    </Button>
                  </Modal.Footer>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
