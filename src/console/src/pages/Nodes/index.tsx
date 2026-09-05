import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  Modal,
  Spinner,
  Tabs,
  TextField,
} from '@heroui/react';
import {
  CircleCheckFill,
  PlugConnection,
  Server,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import { getStorageStatus } from '../../api/system';
import { getApiOrigin } from '../../api/client';
import {
  connectMeshNode,
  createMeshNode,
  deleteMeshNode,
  disconnectMeshNode,
  listMeshNodes,
  type MeshAuthInput,
  type MeshNode,
} from '../../api/mesh';
import { getStoredUser } from '../../api/auth';
import { useDialog } from '../../hooks/useDialog';

const STORE_LABEL: Record<string, string> = { sqlite: 'SQLite', mongo: 'MongoDB' };
const REFRESH_MS = 15000;

/**
 * Server nodes (workspace mesh). The current service is always present as the
 * local node card (its store type comes from /api/system/storage); remote
 * Libra services can be registered and connected as mesh nodes (admin).
 */
export default function NodesPage() {
  const { t } = useTranslation();
  const { confirm, DialogComponent } = useDialog();
  const isAdmin = getStoredUser()?.role === 'Admin';

  const [localStore, setLocalStore] = useState<'sqlite' | 'mongo' | null>(null);
  const [nodes, setNodes] = useState<MeshNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshLocal = useCallback(async () => {
    try {
      const s = await getStorageStatus();
      setLocalStore(s.effective === 'mongo' ? 'mongo' : 'sqlite');
    } catch {
      /* local store chip stays unknown; page remains usable */
    }
  }, []);

  const refreshNodes = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setNodes(await listMeshNodes());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [isAdmin]);

  useEffect(() => {
    void refreshLocal();
    if (!isAdmin) return;
    void refreshNodes();
    const timer = setInterval(() => {
      void refreshLocal();
      void refreshNodes();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshLocal, refreshNodes, isAdmin]);

  const runAction = async (id: string, action: () => Promise<unknown>, then: () => void) => {
    setBusyId(id);
    setActionError(null);
    try {
      await action();
      then();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (node: MeshNode) => {
    const { confirmed } = await confirm(t('nodes.deleteConfirm', { name: node.name }));
    if (!confirmed) return;
    await runAction(
      node.id,
      () => deleteMeshNode(node.id),
      () => void refreshNodes(),
    );
  };

  return (
    <div className="space-y-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          {t('nodes.remoteSection')}
        </h2>
        {isAdmin && (
          <Button size="sm" variant="primary" onPress={() => setAddOpen(true)}>
            <PlugConnection className="size-4" />
            {t('nodes.add')}
          </Button>
        )}
      </div>

      {/* One grid: the local service always sits first, remote nodes follow. */}
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
        <LocalNodeCard storeType={localStore} />
        {isAdmin &&
          nodes?.map((node) => (
            <RemoteNodeCard
              key={node.id}
              node={node}
              busy={busyId === node.id}
              onConnect={() =>
                runAction(node.id, () => connectMeshNode(node.id), () => void refreshNodes())
              }
              onDisconnect={() =>
                runAction(
                  node.id,
                  () => disconnectMeshNode(node.id),
                  () => void refreshNodes(),
                )
              }
              onDelete={() => void handleDelete(node)}
            />
          ))}
      </div>

      {!isAdmin ? (
        <p className="text-xs text-default-400">{t('nodes.remoteAdminOnly')}</p>
      ) : nodes === null && !loadError ? (
        <div className="flex items-center justify-center py-10">
          <Spinner size="lg" />
        </div>
      ) : loadError && nodes === null ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-danger">{t('nodes.loadFailed')}</p>
          <Button size="sm" variant="ghost" className="mt-3" onPress={() => void refreshNodes()}>
            {t('nodes.retry')}
          </Button>
        </Card>
      ) : nodes!.length === 0 ? (
        <Card className="p-6 text-center text-sm text-default-500">
          <Server className="mx-auto mb-2 size-6 opacity-60" />
          {t('nodes.empty')}
        </Card>
      ) : null}

      {(loadError || actionError) && isAdmin && nodes !== null && (
        <p className="text-xs text-danger" role="alert">
          {loadError ? `${t('nodes.loadFailed')}: ${loadError}` : actionError}
        </p>
      )}

      <AddNodeModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          void refreshNodes();
        }}
      />

      {DialogComponent}
    </div>
  );
}

function LocalNodeCard({ storeType }: { storeType: 'sqlite' | 'mongo' | null }) {
  const { t } = useTranslation();
  const origin = getApiOrigin();
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-soft-foreground">
          <Server className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{t('nodes.localName')}</h3>
            <Chip size="sm" variant="soft">{t('nodes.localBadge')}</Chip>
            <Chip size="sm" variant="soft" color="success">{t('nodes.connected')}</Chip>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-default-500">{origin}</p>
        </div>
        <StoreChip storeType={storeType} />
      </div>
    </Card>
  );
}

function RemoteNodeCard({
  node,
  busy,
  onConnect,
  onDisconnect,
  onDelete,
}: {
  node: MeshNode;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col p-5">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-2xl ${
            node.connected ? 'bg-accent-soft text-accent-soft-foreground' : 'bg-default/10 text-muted'
          }`}
        >
          <Server className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">{node.name}</h3>
            {node.connected && (
              <Chip size="sm" variant="soft" color="success">
                <CircleCheckFill className="size-3" />
                {t('nodes.connected')}
              </Chip>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-default-500">{node.origin}</p>
          {node.lastError && (
            <p className="mt-1 line-clamp-2 text-xs text-danger" title={node.lastError}>
              {node.lastError}
            </p>
          )}
          {node.lastConnectedAt && !node.connected && (
            <p className="mt-0.5 text-xs text-default-400">
              {t('nodes.lastConnectedAt')}: {new Date(node.lastConnectedAt).toLocaleString()}
            </p>
          )}
        </div>
        <StoreChip storeType={node.storageType ?? null} connected={node.connected} />
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-default-200/70 pt-3 dark:border-default-800">
        {node.connected ? (
          <Button size="sm" variant="ghost" isDisabled={busy} onPress={onDisconnect}>
            <Xmark className="size-4" />
            {t('nodes.disconnect')}
          </Button>
        ) : (
          <Button size="sm" variant="primary" isDisabled={busy} onPress={onConnect}>
            <PlugConnection className="size-4" />
            {t('nodes.connect')}
          </Button>
        )}
        <Button size="sm" variant="ghost" isIconOnly isDisabled={busy} onPress={onDelete} aria-label={t('nodes.delete')}>
          <TrashBin className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

function StoreChip({ storeType, connected }: { storeType: 'sqlite' | 'mongo' | null; connected?: boolean }) {
  const { t } = useTranslation();
  const label = storeType ? STORE_LABEL[storeType] : undefined;
  return (
    <Chip
      size="sm"
      variant="soft"
      color={storeType === 'sqlite' ? 'accent' : storeType === 'mongo' ? 'success' : 'default'}
    >
      {label
        ? t('nodes.storage') + ': ' + label
        : connected
          ? t('nodes.storageUnknown')
          : t('nodes.storageNotConnected')}
    </Chip>
  );
}

function AddNodeModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [kind, setKind] = useState<'password' | 'accessKey'>('password');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setName('');
      setOrigin('');
      setKind('password');
      setUsername('');
      setSecret('');
      setError(null);
    }
    prevOpen.current = open;
  }, [open]);

  const canSave = name.trim().length > 0 && origin.trim().length > 0 && secret.trim().length > 0
    && (kind === 'accessKey' || username.trim().length > 0);

  const handleSave = async () => {
    setError(null);
    const auth: MeshAuthInput = {
      kind,
      secret: secret.trim(),
      ...(kind === 'password' ? { username: username.trim() } : {}),
    };
    setSaving(true);
    try {
      const node = await createMeshNode({ name: name.trim(), origin: origin.trim(), auth });
      // Connect right away so storage type + status are visible immediately;
      // a failed connect keeps the registration (error shown on its card).
      try {
        await connectMeshNode(node.id);
      } catch {
        /* registration succeeded; the card surfaces the connect failure */
      }
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('nodes.addDesc')}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="space-y-4">
            <TextField variant="secondary">
              <Label>{t('nodes.name')}</Label>
              <Input value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder={t('nodes.namePlaceholder')} />
            </TextField>
            <TextField variant="secondary">
              <Label>{t('nodes.origin')}</Label>
              <Input value={origin} onChange={(e) => setOrigin((e.target as HTMLInputElement).value)} placeholder="http://192.168.1.10:5270" />
            </TextField>

            <Tabs selectedKey={kind} onSelectionChange={(key) => setKind(String(key) as 'password' | 'accessKey')}>
              <Tabs.List>
                <Tabs.Tab id="password">{t('nodes.authPassword')}<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="accessKey">{t('nodes.authKey')}<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs>

            {kind === 'password' ? (
              <>
                <TextField variant="secondary">
                  <Label>{t('nodes.username')}</Label>
                  <Input value={username} onChange={(e) => setUsername((e.target as HTMLInputElement).value)} />
                </TextField>
                <TextField variant="secondary">
                  <Label>{t('nodes.password')}</Label>
                  <Input type="password" value={secret} onChange={(e) => setSecret((e.target as HTMLInputElement).value)} />
                </TextField>
              </>
            ) : (
              <TextField variant="secondary">
                <Label>{t('nodes.accessKey')}</Label>
                <Input type="password" value={secret} onChange={(e) => setSecret((e.target as HTMLInputElement).value)} placeholder="lnk_…" />
              </TextField>
            )}

            {error && <p className="text-sm text-danger">{error}</p>}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" isPending={saving} isDisabled={!canSave} onPress={() => void handleSave()}>
              {t('nodes.add')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
