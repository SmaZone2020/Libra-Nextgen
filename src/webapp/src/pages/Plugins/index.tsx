import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Chip,
  Modal,
  Spinner,
  Switch,
  TextArea,
  TextField,
  Label,
  Input,
} from '@heroui/react';
import { PlugConnection, TrashBin, Pencil, Plus } from '@gravity-ui/icons';
import { useDialog } from '../../hooks/useDialog';
import {
  listPlugins,
  importPlugin,
  createPlugin,
  updatePlugin,
  deletePlugin,
  togglePlugin,
  type PluginRecord,
  type PluginMeta,
} from '../../api/plugins';

// A blank meta template used for "new plugin" authoring.
function blankMeta(pluginId: string): PluginMeta {
  return {
    schemaVersion: 1,
    pluginId,
    name: '',
    version: '1.0.0',
    author: '',
    description: '',
    entry: { route: pluginId, label: `nav.${pluginId}`, icon: 'Cpu', apiRoot: `/api/plugins/${pluginId}` },
    actions: [],
  };
}

export default function PluginsPage() {
  const { t } = useTranslation();
  const { confirm, DialogComponent } = useDialog();
  const [plugins, setPlugins] = useState<PluginRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editor modal state
  const [editing, setEditing] = useState<PluginRecord | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [metaJson, setMetaJson] = useState('');
  const [saving, setSaving] = useState(false);

  const editorOpen = editing !== null || isNew;

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

  const openEditor = (record: PluginRecord | null) => {
    if (record) {
      setIsNew(false);
      setEditing(record);
      const { id: _id, enabled: _en, installedAt: _i, updatedAt: _u, ...meta } = record;
      setMetaJson(JSON.stringify(meta, null, 2));
    } else {
      setIsNew(true);
      setEditing(null);
      setMetaJson(JSON.stringify(blankMeta('com.example.my-plugin'), null, 2));
    }
  };

  const closeEditor = () => {
    setEditing(null);
    setIsNew(false);
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
      if (isNew) await createPlugin(meta);
      else if (editing) await updatePlugin(editing.id, meta);
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

  if (plugins === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('plugins.title')}</h2>
            <p className="text-sm text-default-500">{t('plugins.desc')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onPress={() => fileRef.current?.click()}>
              <PlugConnection />
              {t('plugins.import')}
            </Button>
            <Button variant="primary" onPress={() => openEditor(null)}>
              <Plus />
              {t('plugins.new')}
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

      {error && (
        <Card className="p-4 border border-danger">
          <p className="text-danger text-sm">{error}</p>
        </Card>
      )}

      {plugins.length === 0 ? (
        <Card className="p-12 text-center text-default-500">
          {t('plugins.empty')}
        </Card>
      ) : (
        <div className="grid gap-4">
          {plugins.map((p) => (
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

      {/* Editor modal */}
      <Modal.Backdrop isOpen={editorOpen} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {isNew ? t('plugins.new') : t('plugins.edit', { name: editing?.name || editing?.pluginId })}
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
      {DialogComponent}
    </div>
  );
}
