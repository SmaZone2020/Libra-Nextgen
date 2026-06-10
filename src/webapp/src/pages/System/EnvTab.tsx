import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input, Label, Modal, Tabs, TextField } from '@heroui/react';
import { Pencil, TrashBin } from '@gravity-ui/icons';
import { getEnvVars, setEnvVar, deleteEnvVar } from '../../api/system';
import { DataGrid } from '../../components/data-grid';
import { ContextMenu } from '@components/context-menu';
import type { DataGridColumn } from '../../components/data-grid';
import type { EnvVar } from '../../types/models';

const columns: DataGridColumn<EnvVar>[] = [
  {
    id: 'name', header: 'Name',
    cell: (item) => <span className="font-mono text-sm">{item.name}</span>,
    allowsSorting: true,
    sortFn: (a, b) => a.name.localeCompare(b.name),
  },
  {
    id: 'value', header: 'Value',
    cell: (item) => (
      <span className="text-default-500 text-sm truncate max-w-[400px] block">
        {item.value}
      </span>
    ),
  },
];

interface EnvTabProps {
  agentId: string;
}

export function EnvTab({ agentId }: EnvTabProps) {
  const [systemVars, setSystemVars] = useState<EnvVar[]>([]);
  const [userVars, setUserVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<string>('system');

  const [modalOpen, setModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editScope, setEditScope] = useState('user');
  const [isEditing, setIsEditing] = useState(false);

  const contextRef = useRef<EnvVar | null>(null);

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

  const handleEdit = () => {
    if (!contextRef.current) return;
    setEditName(contextRef.current.name);
    setEditValue(contextRef.current.value);
    setEditScope(scope);
    setIsEditing(true);
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
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    await setEnvVar(agentId, editName, editValue, editScope);
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
          <Tabs.List aria-label="Env scope">
            <Tabs.Tab id="system">System<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="user">User<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Button size="sm" variant="ghost" onPress={handleAdd}>
          Add Variable
        </Button>
        <span className="text-sm text-default-500">{currentVars.length} variables</span>
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
                  {loading ? 'Loading...' : 'No environment variables found.'}
                </div>
              )}
            />
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Popover>
          <ContextMenu.Menu>
            <ContextMenu.Item id="edit" textValue="Edit" onAction={handleEdit}>
              <Pencil className="w-4 h-4" /> Edit
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item id="delete" textValue="Delete" onAction={handleDelete}>
              <TrashBin className="w-4 h-4" /> Delete
            </ContextMenu.Item>
          </ContextMenu.Menu>
        </ContextMenu.Popover>
      </ContextMenu>

      <Modal.Backdrop isOpen={modalOpen} onOpenChange={setModalOpen}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{isEditing ? 'Edit Variable' : 'Add Variable'}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-4">
                <TextField value={editName} onChange={setEditName} isDisabled={isEditing}>
                  <Label>Name</Label>
                  <Input placeholder="VARIABLE_NAME" />
                </TextField>
                <TextField value={editValue} onChange={setEditValue}>
                  <Label>Value</Label>
                  <Input placeholder="value" />
                </TextField>
                {!isEditing && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={editScope === 'user' ? 'primary' : 'ghost'}
                      onPress={() => setEditScope('user')}
                    >
                      User
                    </Button>
                    <Button
                      size="sm"
                      variant={editScope === 'system' ? 'primary' : 'ghost'}
                      onPress={() => setEditScope('system')}
                    >
                      System
                    </Button>
                  </div>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="ghost">Cancel</Button>
              <Button variant="primary" onPress={handleSave}>Save</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
