import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Modal, Tabs, TextArea, TextField } from '@heroui/react';
import { Pencil, TrashBin } from '@gravity-ui/icons';
import { getEnvVars, setEnvVar, deleteEnvVar } from '../../api/system';
import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import type { DataGridColumn } from '../../components/data-grid';
import type { EnvVar } from '../../types/models';

interface EnvTabProps {
  agentId: string;
}

export function EnvTab({ agentId }: EnvTabProps) {
  const { t } = useTranslation();
  const [systemVars, setSystemVars] = useState<EnvVar[]>([]);
  const [userVars, setUserVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<string>('system');

  const [modalOpen, setModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editScope, setEditScope] = useState('user');
  const [isEditing, setIsEditing] = useState(false);
  const [useTextarea, setUseTextarea] = useState(false);

  const contextRef = useRef<EnvVar | null>(null);

  const columns: DataGridColumn<EnvVar>[] = [
    {
      id: 'name', header: t('common.name'),
      cell: (item) => <span className="font-mono text-sm">{item.name}</span>,
      allowsSorting: true,
      sortFn: (a, b) => a.name.localeCompare(b.name),
    },
    {
      id: 'value', header: t('common.value'),
      cell: (item) => (
        <span className="text-default-500 text-sm truncate max-w-[400px] block">
          {item.value}
        </span>
      ),
    },
  ];

  const fetchEnv = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getEnvVars(agentId);
      setSystemVars(res.system);
      setUserVars(res.user);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  const handleContextMenu = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest('[role="row"][data-key]');
    const key = row ? row.getAttribute('data-key') : null;
    const vars = scope === 'system' ? systemVars : userVars;
    contextRef.current = vars.find(v => v.name === key) ?? null;
  };

  const isMultiValue = (val: string) => val.includes(';');

  const toLines = (val: string) => val.split(';').join('\n');
  const fromLines = (val: string) => val.split('\n').join(';');

  const handleEdit = () => {
    if (!contextRef.current) return;
    const val = contextRef.current.value;
    const multi = isMultiValue(val);
    setEditName(contextRef.current.name);
    setEditValue(multi ? toLines(val) : val);
    setEditScope(scope);
    setIsEditing(true);
    setUseTextarea(multi);
    setModalOpen(true);
  };

  const handleDelete = async () => {
    if (!contextRef.current) return;
    await deleteEnvVar(agentId, contextRef.current.name, scope);
    fetchEnv();
  };

  const handleAdd = () => {
    setEditName('');
    setEditValue('');
    setEditScope(scope);
    setIsEditing(false);
    setUseTextarea(false);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    const saveValue = useTextarea ? fromLines(editValue) : editValue;
    await setEnvVar(agentId, editName, saveValue, editScope);
    setModalOpen(false);
    fetchEnv();
  };

  const currentVars = scope === 'system' ? systemVars : userVars;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Tabs
          selectedKey={scope}
          onSelectionChange={(key) => setScope(String(key))}
        >
          <Tabs.List aria-label={t('system.infoTabs')}>
            <Tabs.Tab id="system">{t('system.scopes.system')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="user">{t('system.scopes.user')}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Button size="sm" variant="tertiary" onPress={handleAdd}>
          {t('system.addVariable')}
        </Button>
        <span className="text-sm text-default-500">{t('system.varsCount', { count: currentVars.length })}</span>
      </div>

      <ContextMenu>
        <ContextMenu.Trigger className="w-full">
          <div onContextMenu={handleContextMenu}>
            <DataGrid
              aria-label="Environment variables"
              columns={columns}
              data={currentVars}
              getRowId={(v) => v.name}
              scrollContainerClassName="max-h-[calc(100vh-300px)]"
              renderEmptyState={() => (
                <div className="flex justify-center py-8 text-default-500 text-sm">
                  {loading ? t('common.loading') : t('system.noEnvVars')}
                </div>
              )}
            />
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Popover>
          <ContextMenu.Menu>
            <ContextMenu.Item id="edit" textValue={t('common.edit')} onAction={handleEdit}>
              <Pencil className="w-4 h-4" /> {t('common.edit')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item id="delete" textValue={t('common.delete')} onAction={handleDelete}>
              <TrashBin className="w-4 h-4" /> {t('common.delete')}
            </ContextMenu.Item>
          </ContextMenu.Menu>
        </ContextMenu.Popover>
      </ContextMenu>

      <Modal.Backdrop isOpen={modalOpen} onOpenChange={setModalOpen}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{isEditing ? t('system.editVariable') : t('system.addVariableTitle')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-4">
                <TextField variant="secondary" value={editName} onChange={setEditName} isDisabled={isEditing}>
                  <Label>{t('common.name')}</Label>
                  <Input placeholder={t('system.varName')} />
                </TextField>
                {useTextarea ? (
                  <TextField variant="secondary" value={editValue} onChange={setEditValue}>
                    <Label>{t('system.valueMultiline')}</Label>
                    <TextArea className="font-mono text-sm" rows={10} placeholder="entry1&#10;entry2&#10;entry3" />
                  </TextField>
                ) : (
                  <TextField variant="secondary" value={editValue} onChange={setEditValue}>
                    <Label>{t('common.value')}</Label>
                    <Input placeholder={t('system.valuePlaceholder')} />
                  </TextField>
                )}
                {!isEditing && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={editScope === 'user' ? 'primary' : 'ghost'}
                      onPress={() => setEditScope('user')}
                    >
                      {t('system.scopes.user')}
                    </Button>
                    <Button
                      size="sm"
                      variant={editScope === 'system' ? 'primary' : 'ghost'}
                      onPress={() => setEditScope('system')}
                    >
                      {t('system.scopes.system')}
                    </Button>
                  </div>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
              <Button variant="primary" onPress={handleSave}>{t('common.save')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
