import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Modal,
  Spinner,
  Switch,
  Tabs,
  TextArea,
  TextField,
  Label,
  Input,
} from '@heroui/react';
import {
  PlugConnection,
  TrashBin,
  LogoGithub,
  ArrowUpRightFromSquare,
  CircleCheckFill,
} from '@gravity-ui/icons';
import { useDialog } from '../../hooks/useDialog';
import {
  listPlugins,
  importPlugin,
  importPluginFromGit,
  updatePlugin,
  deletePlugin,
  togglePlugin,
  type PluginRecord,
  type PluginMeta,
} from '../../api/plugins';
import { useNavigate } from 'react-router-dom';
import { MarketTab } from './MarketTab';
import { PluginCard } from './PluginCard';


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

  const navigate = useNavigate();

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

  // No installed plugins → land on the market tab so the page is never a dead end.
  const initialTab = plugins.length === 0 ? 'market' : 'installed';

  return (
    <div className="space-y-4">

      <Tabs key={initialTab} defaultSelectedKey={initialTab} className="w-full">
        <div className="p-6">
          <div className="flex items-center justify-between flex-wrap gap-4 sm:flex sm:gap-0">
              <Tabs.ListContainer className="sm:w-auto">
                <Tabs.List aria-label="plugins sections">
                  <Tabs.Tab id="installed" className="w-[160px]">{t('plugins.installedTab')}<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="market" className="w-[160px]">{t('plugins.market')}<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            <div className="flex items-center gap-2 w-full sm:w-auto sm:justify-end">
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
        </div>

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
              <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
                {plugins!.map((p) => (
                  <PluginCard
                    key={p.id}
                    name={p.name || p.pluginId}
                    description={p.description}
                    version={p.version}
                    author={p.author}
                    route={p.entry?.route}
                    actions={
                      <div className="flex items-center justify-between gap-2 pb-4">
                        <div className="flex items-center gap-2 text-sm text-default-500 min-w-0">
                          <p className="truncate">{p.actions.length} {t('plugins.actions')}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {p.entry?.route && (
                            <Button isIconOnly variant="secondary" onPress={() => navigate(`/plugins/${(p.entry as NonNullable<typeof p.entry>).route}`)}>
                              <ArrowUpRightFromSquare className="w-4 h-4" />
                            </Button>
                          )}
                          <Button isIconOnly variant="ghost" onPress={() => handleDelete(p)}>
                            <TrashBin />
                          </Button>
                        </div>
                      </div>
                    }
                    footer={
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-sm text-muted">
                          {t('plugins.installedAt')}: {new Date(p.installedAt).toLocaleString()}
                        </span>
                        <Switch isSelected={p.enabled} onChange={(v) => handleToggle(p, v)}>
                          <Switch.Content>
                            <Switch.Control><Switch.Thumb /></Switch.Control>
                          </Switch.Content>
                        </Switch>
                      </div>
                    }
                  />
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
        <Modal.Container placement="center" size="lg">
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
        <Modal.Container placement="center" size="md">
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

