'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, Modal, Spinner, Table, TextField } from '@heroui/react';
import { listAccessKeys, createAccessKey, deleteAccessKey } from '../../api/accessKeys';
import type { AccessKeyItem, AccessKeyCreateResponse } from '../../api/accessKeys';
import { useDialog } from '../../hooks/useDialog';

export default function AccessKeysTab() {
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
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label={t('settings.accessKeys')} className="min-w-[800px]">
              <Table.Header>
                <Table.Column isRowHeader>{t('settings.name')}</Table.Column>
                <Table.Column>{t('settings.key')}</Table.Column>
                <Table.Column>{t('settings.createdAt')}</Table.Column>
                <Table.Column>{t('settings.expiresAt')}</Table.Column>
                <Table.Column>{t('settings.lastUsedAt')}</Table.Column>
                <Table.Column>{t('settings.actions')}</Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={() => (
                <div className="py-8 text-center text-default-400">{t('settings.noKeys')}</div>
              )}>
                {keys.map((k) => (
                  <Table.Row key={k.id} id={k.id}>
                    <Table.Cell>{k.name}</Table.Cell>
                    <Table.Cell className="font-mono text-xs">{k.keyPreview}...</Table.Cell>
                    <Table.Cell>{new Date(k.createdAt).toLocaleDateString()}</Table.Cell>
                    <Table.Cell>
                      {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '-'}
                    </Table.Cell>
                    <Table.Cell>
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : '-'}
                    </Table.Cell>
                    <Table.Cell>
                      <Button size="sm" variant="danger" onPress={() => handleDelete(k.id)}>
                        {t('settings.delete')}
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card>
      <Modal.Backdrop isOpen={createOpen} onOpenChange={(open) => { if (!open) closeCreateModal(); }}>
        <Modal.Container placement="center" size="sm">
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
                    <TextField variant="secondary" className="flex-1">
                      <Label className="sr-only">{t('settings.key')}</Label>
                      <Input variant="secondary" readOnly value={createdKey} className="font-mono text-xs" />
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
                    <TextField variant="secondary" value={newName} onChange={setNewName}>
                      <Label>{t('settings.name')}</Label>
                      <Input variant="secondary" placeholder="My AI Client" />
                    </TextField>
                    <TextField variant="secondary" value={newExpires} onChange={setNewExpires}>
                      <Label>{t('settings.expiresAt')}</Label>
                      <Input variant="secondary" type="date" />
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
