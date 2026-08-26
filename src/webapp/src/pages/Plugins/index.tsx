import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Chip,
  Modal,
  Spinner,
  Switch,
  Tabs,
  TextArea,
  TextField,
  Label,
  Input,
} from '@heroui/react';
import { PlugConnection, TrashBin, Pencil, LogoGithub, ArrowRotateRight } from '@gravity-ui/icons';
import { useDialog } from '../../hooks/useDialog';
import {
  listPlugins,
  importPlugin,
  importPluginFromGit,
  installPluginFromRegistry,
  getPluginRegistry,
  clearPluginRegistryCache,
  updatePlugin,
  deletePlugin,
  togglePlugin,
  type PluginRecord,
  type PluginMeta,
  type PluginRegistryIndex,
} from '../../api/plugins';

function isValidGitUrl(url: string): boolean {
  const u = url.trim();
  if (!u || /\s/.test(u)) return false;
  return /^(https?:\/\/|git@|ssh:\/\/)/i.test(u);
}

export default function PluginsPage() {
  const { t } = useTranslation();
  const { confirm, DialogComponent } = useDialog();
  const [plugins, setPlugins] = useState<PluginRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editor modal state
  const [editing, setEditing] = useState<PluginRecord | null>(null);
  const [metaJson, setMetaJson] = useState('');
  const [saving, setSaving] = useState(false);

  // Git import modal state
  const [gitOpen, setGitOpen] = useState(false);
  const [gitUrl, setGitUrl] = useState('');
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitImporting, setGitImporting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setPlugins(await listPlugins());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load plugins');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openEditor = (record: PluginRecord) => {
    setEditing(record);
    const { id: _id, enabled: _en, installedAt: _i, updatedAt: _u, ...meta } = record;
    setMetaJson(JSON.stringify(meta, null, 2));
  };

  const closeEditor = () => {
    setEditing(null);
    setMetaJson('');
  };

  const parseMeta = (): PluginMeta => {
    try {
      return JSON.parse(metaJson) as PluginMeta;
    } catch {
      throw new Error(t('plugins.invalidJson'));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const meta = parseMeta();
      if (editing) await updatePlugin(editing.id, meta);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const handleImport = async (file: File) => {
    try {
      await importPlugin(file, true);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    }
  };

  const openGitModal = () => {
    setGitUrl('');
    setGitError(null);
    setGitOpen(true);
  };

  const handleGitImport = async () => {
    setGitError(null);
    const url = gitUrl.trim();
    if (!isValidGitUrl(url)) {
      setGitError(t('plugins.gitInvalidUrl'));
      return;
    }
    setGitImporting(true);
    try {
      await importPluginFromGit(url, true);
      window.location.reload();
    } catch (e) {
      setGitError(e instanceof Error ? e.message : 'Git import failed');
    } finally {
      setGitImporting(false);
    }
  };

  const handleDelete = async (record: PluginRecord) => {
    const { confirmed } = await confirm(t('plugins.confirmDelete', { name: record.name || record.pluginId }));
    if (!confirmed) return;
    try {
      await deletePlugin(record.id);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const handleToggle = async (record: PluginRecord, enabled: boolean) => {
    try {
      await togglePlugin(record.id, enabled);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toggle failed');
    }
  };

  const installedIds = new Set(plugins?.map((p) => p.pluginId) ?? []);

  if (plugins === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      <Tabs defaultSelectedKey="installed" className="w-full">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{t('plugins.title')}</h2>
              <p className="text-sm text-default-500">{t('plugins.desc')}</p>
            </div>
              <Tabs.ListContainer>
                <Tabs.List aria-label="plugins sections">
                  <Tabs.Tab id="installed" className="w-[160px]">{t('plugins.installedTab')}<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="market" className="w-[160px]">{t('plugins.market')}<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            <div className="flex items-center gap-2">
              <Button onPress={() => fileRef.current?.click()}>
                <PlugConnection />
                {t('plugins.import')}
              </Button>
              <Button variant="outline" onPress={openGitModal}>
                <LogoGithub />
                {t('plugins.gitImport')}
              </Button>
            </div>
          </div>
          <Input
            ref={fileRef}
            type="file"
            accept=".zip,.7z,.rar"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = '';
            }}
          />
        </Card>

        <Tabs.Panel id="installed">
          <div className="space-y-4">
            {error && (
              <Card className="p-4 border border-danger">
                <p className="text-danger text-sm">{error}</p>
              </Card>
            )}

            {plugins!.length === 0 ? (
              <Card className="p-12 text-center text-default-500">
                {t('plugins.empty')}
              </Card>
            ) : (
              <div className="grid gap-4">
                {plugins!.map((p) => (
                  <Card key={p.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{p.name || p.pluginId}</span>
                          <Chip size="sm" variant="secondary">{p.version}</Chip>
                          <Chip size="sm" color={p.enabled ? 'success' : 'default'}>
                            {p.enabled ? t('plugins.enabled') : t('plugins.disabled')}
                          </Chip>
                        </div>
                        <p className="text-xs text-default-500 mt-1 font-mono">{p.pluginId}</p>
                        {p.description && <p className="text-sm mt-1 text-default-600">{p.description}</p>}
                        <p className="text-xs text-default-400 mt-1">
                          {p.author && `${p.author} · `}{p.actions.length} {t('plugins.actions')} · {p.entry?.route ? `/plugins/${p.entry.route}` : t('plugins.noRoute')}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Switch isSelected={p.enabled} onChange={(v) => handleToggle(p, v)}>
                          <Switch.Control><Switch.Thumb /></Switch.Control>
                        </Switch>
                        <Button isIconOnly variant="ghost" size="sm" onPress={() => openEditor(p)}>
                          <Pencil />
                        </Button>
                        <Button isIconOnly variant="ghost" size="sm" onPress={() => handleDelete(p)}>
                          <TrashBin />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </Tabs.Panel>

        <Tabs.Panel id="market">
          <MarketTab installedIds={installedIds} />
        </Tabs.Panel>
      </Tabs>

      {/* Editor modal */}
      <Modal.Backdrop isOpen={editing !== null} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {t('plugins.edit', { name: editing?.name || editing?.pluginId })}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField variant="secondary">
                <Label className="sr-only">meta.json</Label>
                <TextArea
                  value={metaJson}
                  onChange={(e) => setMetaJson((e.target as HTMLTextAreaElement).value)}
                  rows={24}
                  className="font-mono text-xs"
                />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={closeEditor}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" isPending={saving} onPress={save}>
                {t('common.save')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* Git import modal */}
      <Modal.Backdrop isOpen={gitOpen} onOpenChange={(open) => { if (!open) setGitOpen(false); }}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('plugins.gitImport')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField variant="secondary">
                <Label>{t('plugins.gitUrl')}</Label>
                <Input
                  value={gitUrl}
                  onChange={(e) => setGitUrl((e.target as HTMLInputElement).value)}
                  placeholder={t('plugins.gitUrlPlaceholder')}
                  autoFocus
                />
              </TextField>
              {gitError && <p className="text-danger text-sm mt-2">{gitError}</p>}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setGitOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" isPending={gitImporting} onPress={handleGitImport}>
                {t('plugins.importing')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {DialogComponent}
    </div>
  );
}

// ── 插件市场（Libra-Plugins 索引）──────────────────────────────────────
function MarketTab({ installedIds }: { installedIds: Set<string> }) {
  const { t } = useTranslation();
  const [registry, setRegistry] = useState<PluginRegistryIndex | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force: boolean) => {
    setFail(null);
    if (force) setRefreshing(true);
    try {
      setRegistry(await getPluginRegistry({ force }));
    } catch (e) {
      setFail(e instanceof Error ? e.message : t('plugins.marketFail'));
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    clearPluginRegistryCache();
    await load(true);
  }, [load]);

  const install = async (file: string) => {
    setInstalling(file);
    try {
      await installPluginFromRegistry(file);
      window.location.reload();
    } catch (e) {
      setFail(e instanceof Error ? e.message : 'Install failed');
      setInstalling(null);
    }
  };

  if (registry === null && !fail) {
    return (
      <Card className="p-12 flex items-center justify-center">
        <Spinner size="lg" />
      </Card>
    );
  }

  if (fail) {
    return (
      <Card className="p-4 border border-danger">
        <p className="text-danger text-sm">{fail}</p>
      </Card>
    );
  }

  if (!registry || registry.plugins.length === 0) {
    return (
      <Card className="p-12 text-center text-default-500">
        {t('plugins.marketEmpty')}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">{t('plugins.market')}</h3>
        <Button
          id="market-refresh-btn"
          size="sm"
          variant="outline"
          isPending={refreshing}
          onPress={refresh}
        >
          <ArrowRotateRight className="w-4 h-4" />
          {refreshing ? t('plugins.marketRefreshing') : t('plugins.marketRefresh')}
        </Button>
      </div>

      {registry === null && !fail && (
        <Card className="p-12 flex items-center justify-center">
          <Spinner size="lg" />
        </Card>
      )}

      {fail && (
        <Card className="p-4 border border-danger">
          <div className="flex items-center justify-between gap-4">
            <p className="text-danger text-sm">{fail}</p>
            <Button variant="ghost" onPress={refresh}>
              <ArrowRotateRight className="w-4 h-4" />
              {t('plugins.marketRefresh')}
            </Button>
          </div>
        </Card>
      )}

      {!fail && registry && registry.plugins.length === 0 && (
        <Card className="p-12 text-center text-default-500">
          {t('plugins.marketEmpty')}
        </Card>
      )}

      {!fail && registry && registry.plugins.length > 0 && (
        <div className="grid gap-4">
          {registry.plugins.map((p) => {
            const installed = installedIds.has(p.pluginId);
            return (
              <Card key={p.pluginId} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.name || p.pluginId}</span>
                      <Chip size="sm" variant="secondary">{p.version}</Chip>
                      {installed && <Chip size="sm" variant="soft" color="success">{t('plugins.installedChip')}</Chip>}
                    </div>
                    <p className="text-xs text-default-500 mt-1 font-mono">{p.pluginId}</p>
                    {p.description && <p className="text-sm mt-1 text-default-600">{p.description}</p>}
                    <p className="text-xs text-default-400 mt-1">
                      {p.author && `${p.author} · `}{(p.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <Button
                    variant={installed ? 'ghost' : 'primary'}
                    size="sm"
                    isDisabled={installed}
                    isPending={installing === p.file}
                    onPress={() => install(p.file)}
                  >
                    {t('plugins.install')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
