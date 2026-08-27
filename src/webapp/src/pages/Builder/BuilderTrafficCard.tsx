import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, Modal, TextField } from '@heroui/react';
import { ListView } from '@components/list-view';
import type { Selection } from 'react-aria-components';
import { Plus, TrashBin } from '@gravity-ui/icons';
import type { BuildListItem, TrafficListName } from '../../api/build';

interface BuilderTrafficCardProps {
  lists: {
    userAgents: BuildListItem[];
    extraHeaders: BuildListItem[];
    pathSuffixes: BuildListItem[];
  } | null;
  onAddItem: (list: TrafficListName, value: string) => Promise<void>;
  onToggleItem: (list: TrafficListName, id: string, enabled: boolean) => Promise<void>;
  onDeleteItem: (list: TrafficListName, id: string) => Promise<void>;
}

interface GroupDef {
  list: TrafficListName;
  titleKey: string;
  placeholder: string;
  inputLabelKey: string;
}

const GROUPS: GroupDef[] = [
  { list: 'userAgents', titleKey: 'builder.trafficUa', placeholder: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) …', inputLabelKey: 'builder.trafficUaLabel' },
  { list: 'extraHeaders', titleKey: 'builder.trafficHeaders', placeholder: 'X-Requested-With: XMLHttpRequest', inputLabelKey: 'builder.trafficHeadersLabel' },
  { list: 'pathSuffixes', titleKey: 'builder.trafficSuffixes', placeholder: 'user/info', inputLabelKey: 'builder.trafficSuffixesLabel' },
];

/** 流量伪装配置：持久化列表（服务端存储），ListView 多选=启用，右侧删除按钮。 */
export function BuilderTrafficCard({ lists, onAddItem, onToggleItem, onDeleteItem }: BuilderTrafficCardProps) {
  const { t } = useTranslation();
  const [activeGroup, setActiveGroup] = useState<GroupDef | null>(null);
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openAdd = (g: GroupDef) => {
    setActiveGroup(g);
    setNewValue('');
    setError(null);
  };

  const confirmAdd = async () => {
    if (!activeGroup) return;
    const value = newValue.trim();
    if (!value) return;
    setAdding(true);
    setError(null);
    try {
      await onAddItem(activeGroup.list, value);
      setActiveGroup(null);
      setNewValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleSelectionChange = (g: GroupDef) => (keys: Selection) => {
    const selected = keys as Set<string>;
    const items = lists?.[g.list] ?? [];
    for (const item of items) {
      const now = selected.has(item.id);
      if (now !== item.enabled) {
        void onToggleItem(g.list, item.id, now);
      }
    }
  };

  return (
    <Card className="p-4">
      <h2 className="text-lg font-semibold mb-3">{t('builder.trafficTitle')}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {GROUPS.map((g) => {
          const items = lists?.[g.list] ?? [];
          return (
            <div key={g.list}>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">{t(g.titleKey)}</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label={`${t('builder.addTrafficItem')}: ${t(g.titleKey)}`}
                  onPress={() => openAdd(g)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {items.length === 0 ? (
                <p className="text-xs text-default-500 py-2">{t('builder.noTrafficItems')}</p>
              ) : (
                <ListView
                  aria-label={t(g.titleKey)}
                  className="max-h-56 overflow-y-auto"
                  items={items}
                  selectedKeys={new Set(items.filter(i => i.enabled).map(i => i.id))}
                  selectionMode="multiple"
                  variant="primary"
                  onSelectionChange={handleSelectionChange(g)}
                >
                  {(item: BuildListItem) => (
                    <ListView.Item id={item.id} textValue={item.value}>
                      <ListView.ItemContent>
                        <ListView.Title className="font-mono text-xs break-all">{item.value}</ListView.Title>
                      </ListView.ItemContent>
                      <ListView.ItemAction>
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          aria-label={t('builder.deleteTrafficItem')}
                          onPress={() => void onDeleteItem(g.list, item.id)}
                        >
                          <TrashBin className="w-4 h-4 text-danger" />
                        </Button>
                      </ListView.ItemAction>
                    </ListView.Item>
                  )}
                </ListView>
              )}
            </div>
          );
        })}
      </div>

      {/* 增加项模态框 */}
      <Modal isOpen={!!activeGroup} onOpenChange={(open) => { if (!open) setActiveGroup(null); }}>
        <Modal.Backdrop>
          <Modal.Container placement="center">
            <Modal.Dialog className="sm:max-w-md">
              <Modal.Header>
                <Modal.Heading>{activeGroup ? t(activeGroup.titleKey) : ''}</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {error && (
                  <div className="mb-2 p-2 bg-danger-50 text-danger-700 rounded text-xs">{error}</div>
                )}
                <TextField
                  value={newValue}
                  variant="secondary"
                  onChange={setNewValue}
                  autoFocus
                >
                  <Label>{activeGroup ? t(activeGroup.inputLabelKey) : ''}</Label>
                  <Input
                    variant="secondary"
                    placeholder={activeGroup?.placeholder}
                    onKeyDown={(e) => { if (e.key === 'Enter') void confirmAdd(); }}
                  />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setActiveGroup(null)}>
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" isDisabled={!newValue.trim() || adding} onPress={confirmAdd}>
                  {adding ? t('builder.addingTrafficItem') : t('builder.addTrafficItem')}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
}
