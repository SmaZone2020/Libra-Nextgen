import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, Modal, Spinner, TextField } from '@heroui/react';
import { listAccessKeys, createAccessKey, deleteAccessKey } from '../../api/accessKeys';
import type { AccessKeyItem, AccessKeyCreateResponse } from '../../api/accessKeys';
import { useDialog } from '../../hooks/useDialog';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { confirm, DialogComponent } = useDialog();
  const [keys, setKeys] = useState<AccessKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newExpires, setNewExpires] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      const items = await listAccessKeys();
      setKeys(Array.isArray(items) ? items : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const resp: AccessKeyCreateResponse = await createAccessKey({
        name: newName.trim(),
        expiresAt: newExpires || undefined,
      });
      setCreatedKey(resp.key);
      await loadKeys();
    } catch { /* ignore */ }
    finally { setCreating(false); }
  };

  const handleDelete = async (id: string) => {
    const result = await confirm(t('settings.deleteConfirm'));
    if (!result.confirmed) return;
    try {
      await deleteAccessKey(id);
      await loadKeys();
    } catch { /* ignore */ }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const closeCreateModal = () => {
    setCreateOpen(false);
    setNewName('');
    setNewExpires('');
    setCreatedKey(null);
    setCopied(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('settings.accessKeys')}</h2>
          <Button variant="primary" size="sm" onPress={() => setCreateOpen(true)}>
            {t('settings.createKey')}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-default-200">
                <th className="text-left py-2 px-3">{t('settings.name')}</th>
                <th className="text-left py-2 px-3">{t('settings.key')}</th>
                <th className="text-left py-2 px-3">{t('settings.createdAt')}</th>
                <th className="text-left py-2 px-3">{t('settings.expiresAt')}</th>
                <th className="text-left py-2 px-3">{t('settings.lastUsedAt')}</th>
                <th className="text-left py-2 px-3">{t('settings.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-default-100">
                  <td className="py-2 px-3">{k.name}</td>
                  <td className="py-2 px-3 font-mono text-xs">{k.keyPreview}...</td>
                  <td className="py-2 px-3">{new Date(k.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 px-3">
                    {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="py-2 px-3">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="py-2 px-3">
                    <Button size="sm" variant="danger" onPress={() => handleDelete(k.id)}>
                      {t('settings.delete')}
                    </Button>
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-default-400">
                    {t('settings.noKeys')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal.Backdrop isOpen={createOpen} onOpenChange={(open) => { if (!open) closeCreateModal(); }}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            {createdKey ? (
              <>
                <Modal.Header>
                  <Modal.Heading>{t('settings.keyCreated')}</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <p className="text-sm text-default-500 mb-3">{t('settings.keyCreatedHint')}</p>
                  <div className="flex items-center gap-2">
                    <TextField className="flex-1">
                      <Label className="sr-only">{t('settings.key')}</Label>
                      <Input readOnly value={createdKey} className="font-mono text-xs" />
                    </TextField>
                    <Button size="sm" variant="secondary" onPress={() => handleCopy(createdKey)}>
                      {copied ? t('settings.copied') : t('settings.copy')}
                    </Button>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="primary" onPress={closeCreateModal}>
                    {t('settings.done')}
                  </Button>
                </Modal.Footer>
              </>
            ) : (
              <>
                <Modal.Header>
                  <Modal.Heading>{t('settings.createKey')}</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <div className="space-y-4">
                    <TextField value={newName} onChange={setNewName}>
                      <Label>{t('settings.name')}</Label>
                      <Input placeholder="My AI Client" />
                    </TextField>
                    <TextField value={newExpires} onChange={setNewExpires}>
                      <Label>{t('settings.expiresAt')}</Label>
                      <Input type="date" />
                    </TextField>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="ghost" onPress={closeCreateModal}>
                    {t('common.cancel')}
                  </Button>
                  <Button variant="primary" isPending={creating} onPress={handleCreate}>
                    {t('settings.create')}
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      {DialogComponent}
    </div>
  );
}