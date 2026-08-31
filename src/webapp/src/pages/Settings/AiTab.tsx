'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Spinner, Tooltip } from '@heroui/react';
import { TrashBin, Pencil, Plus, ArrowsRotateLeft } from '@gravity-ui/icons';
import { deleteAiProvider, getAiProviders, type AiProvider } from '../../api/ai';
import { ProviderFormModal } from './ProviderFormModal';
import { useDialog } from '../../hooks/useDialog';

export default function AiTab() {
  const { t } = useTranslation();
  const { confirm, alert, DialogComponent } = useDialog();
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AiProvider | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setProviders(await getAiProviders());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (p: AiProvider) => {
    setEditing(p);
    setModalOpen(true);
  };

  const handleDelete = async (p: AiProvider) => {
    const { confirmed } = await confirm(t('settings.aiDeleteConfirm', { name: p.name }));
    if (!confirmed) return;
    try {
      await deleteAiProvider(p.id);
      await reload();
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading && providers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('settings.aiProviders')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip delay={0}>
              <Button isIconOnly size="sm" variant="ghost" aria-label={t('common.refresh')} onPress={() => void reload()}>
                <ArrowsRotateLeft className="size-4" />
              </Button>
              <Tooltip.Content>{t('common.refresh')}</Tooltip.Content>
            </Tooltip>
            <Button size="sm" variant="primary" onPress={openCreate}>
              <Plus className="size-4" />
              {t('settings.aiAddProvider')}
            </Button>
          </div>
        </div>

        {providers.length === 0 ? (
          <div className="py-10 text-center text-sm text-default-400">
            {t('settings.aiNoProviders')}
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-3 rounded-2xl border border-default-200 p-4 sm:flex-row sm:items-center dark:border-default-800"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Chip size="sm" color={p.enabled ? 'success' : 'default'} variant="soft">
                      {p.enabled ? t('mcp.enabled') : t('mcp.disabled')}
                    </Chip>
                    <Chip size="sm" variant="tertiary">{p.providerType}</Chip>
                  </div>
                  <span className="truncate font-mono text-xs text-default-500">{p.baseUrl}</span>
                  <span className="text-xs text-default-500">
                    {p.defaultModel || (p.models[0] ?? '')} · {p.models.length} {t('settings.aiModels')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="tertiary" onPress={() => openEdit(p)}>
                    <Pencil className="size-4" />
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger" onPress={() => void handleDelete(p)}>
                    <TrashBin className="size-4" />
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ProviderFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => void reload()}
      />
      {DialogComponent}
    </div>
  );
}