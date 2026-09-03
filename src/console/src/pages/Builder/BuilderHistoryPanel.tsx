import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Popover, Spinner } from '@heroui/react';
import { ListView } from '@components/list-view';
import type { Selection } from 'react-aria-components';
import { ArrowDownToLine, CircleInfo, TrashBin } from '@gravity-ui/icons';
import type { BuildRecord, TemplateInfo } from '../../types/models';
import type { ModuleEntry } from '../../api/build';
import { PLATFORM_LABEL, STATUS_LABEL } from './constants';
import { relativeTime } from '../../utils/relativeTime';

interface BuilderHistoryPanelProps {
  building: boolean;
  buildStatus: string | null;
  error: string | null;
  history: BuildRecord[];
  templates: TemplateInfo[];
  historyLoading: boolean;
  templateUploading: boolean;
  enabledModules: ModuleEntry[];
  modulesLoading: boolean;
  modulesBuilding: boolean;
  onBuild: () => void;
  onBuildModules: () => void;
  onToggleModule: (name: string, enabled: boolean) => void;
  onOpenInfo: (id: string) => void;
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteTemplate: (platform: string) => void;
  onRebuildFromTemplate: (platform: string) => void;
  onUploadTemplate: (file: File) => void;
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function BuilderHistoryPanel({
  building,
  buildStatus,
  error,
  history,
  templates,
  historyLoading,
  templateUploading,
  enabledModules,
  modulesLoading,
  modulesBuilding,
  onBuild,
  onBuildModules,
  onToggleModule,
  onOpenInfo,
  onDownload,
  onDelete,
  onDeleteTemplate,
  onRebuildFromTemplate,
  onUploadTemplate,
}: BuilderHistoryPanelProps) {
  const { t } = useTranslation();
  const templateFileRef = useRef<HTMLInputElement>(null);

  /** Humanized age: 刚刚 / N 分钟前 / N 小时前 / N 天前 / N 个月前. */
  const formatRelative = (iso: string) => {
    const r = relativeTime(iso);
    return r ? t(r.key, { count: r.count }) : '-';
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUploadTemplate(file);
    if (templateFileRef.current) templateFileRef.current.value = '';
  };

  const handleModuleSelectionChange = (keys: Selection) => {
    const selected = keys as Set<string>;
    for (const m of enabledModules) {
      const now = selected.has(m.name);
      if (now !== m.enabled) onToggleModule(m.name, now);
    }
  };

  return (
    <>
      <Card className="p-4">
        <Button
          variant="primary"
          onPress={onBuild}
          isDisabled={building}
          className="w-full mb-3"
        >
          {building && <Spinner className="mr-1 w-4 h-4" />}
          {building ? (buildStatus ? t(buildStatus) : t('builder.building')) : t('builder.generate')}
        </Button>
        {error && (
          <div className="mb-3 p-2 bg-danger-50 text-danger-700 rounded text-xs">{error}</div>
        )}
        <h2 className="text-lg font-semibold mb-3">{t('builder.history')}</h2>
        {history.length === 0 ? (
          <p className="text-sm text-default-500 py-4 text-center">{t('builder.noHistory')}</p>
        ) : (
          <ListView
            aria-label={t('builder.history')}
            items={history}
            selectionMode="none"
            variant="primary"
          >
            {(record: BuildRecord) => (
              <ListView.Item
                id={record.id}
                textValue={record.fileName}
                onAction={() => onOpenInfo(record.id)}
              >
                <ListView.ItemContent>
                  <ListView.Title>
                    <span className="text-sm font-medium">
                      {PLATFORM_LABEL[record.platform] || record.platform}
                    </span>
                  </ListView.Title>
                  <ListView.Description className="text-xs">
                    {formatRelative(record.createdAt)}
                  </ListView.Description>
                </ListView.ItemContent>
                {record.status !== 'building' && (
                  <ListView.ItemAction>
                    <div className="flex gap-1">
                      {record.status === 'completed' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          aria-label={t('builder.download')}
                          onPress={() => onDownload(record.id)}
                        >
                          <ArrowDownToLine className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        aria-label={t('builder.deleteBuild')}
                        onPress={() => onDelete(record.id)}
                      >
                        <TrashBin className="w-4 h-4 text-danger" />
                      </Button>
                    </div>
                  </ListView.ItemAction>
                )}
              </ListView.Item>
            )}
          </ListView>
        )}
      </Card>

      <Card className="p-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{t('builder.templates')}</h2>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={templateUploading}
            onPress={() => templateFileRef.current?.click()}
          >
            {templateUploading ? <Spinner className="w-3 h-3 mr-1" /> : null}
            {t('builder.uploadTemplate')}
          </Button>
        </div>
        <Input
          title={t('builder.uploadTemplate')}
          ref={templateFileRef}
          type="file"
          accept=".exe,application/octet-stream"
          className="hidden"
          onChange={handleTemplateUpload}
        />
        {templates.length === 0 ? (
          <p className="text-sm text-default-500 py-4 text-center">{t('builder.noTemplates')}</p>
        ) : (
          <ListView
            aria-label={t('builder.templates')}
            items={templates}
            selectionMode="none"
            variant="primary"
          >
            {(tpl: TemplateInfo) => (
              <ListView.Item id={tpl.platform} textValue={tpl.platform}>
                <ListView.ItemContent>
                  <ListView.Title>
                    <span className="text-sm font-medium">{PLATFORM_LABEL[tpl.platform] || tpl.platform}</span>
                  </ListView.Title>
                  <ListView.Description>
                    <span className="text-xs">{tpl.fileName} — {formatSize(tpl.fileSize)}</span>
                  </ListView.Description>
                </ListView.ItemContent>
                <ListView.ItemAction>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => onRebuildFromTemplate(tpl.platform)}
                      isDisabled={building}
                    >
                      {t('builder.rebuildTemplate')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label={t('builder.deleteTemplate')}
                      onPress={() => onDeleteTemplate(tpl.platform)}
                    >
                      <TrashBin className="w-4 h-4 text-danger" />
                    </Button>
                  </div>
                </ListView.ItemAction>
              </ListView.Item>
            )}
          </ListView>
        )}
      </Card>
      {/* 模块管理：文件名驱动（含插件 dll），多选 ListView 启用/禁用 */}
      <Card className="p-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{t('builder.modules')}</h2>
          <Button
            size="sm"
            variant="primary"
            isDisabled={modulesBuilding}
            onPress={onBuildModules}
          >
            {modulesBuilding && <Spinner className="w-3 h-3 mr-1" />}
            {t('builder.buildModules')}
          </Button>
        </div>
        {modulesLoading ? (
          <Spinner className="w-6 h-6 mx-auto my-4" />
        ) : enabledModules.length === 0 ? (
          <p className="text-sm text-default-500 py-4 text-center">{t('builder.noModules')}</p>
        ) : (
          <ListView
            aria-label={t('builder.modules')}
            items={enabledModules}
            selectedKeys={new Set(enabledModules.filter(m => m.enabled).map(m => m.name))}
            disabledKeys={modulesBuilding || building ? new Set(enabledModules.map(m => m.name)) : new Set()}
            selectionMode="multiple"
            variant="primary"
            onSelectionChange={handleModuleSelectionChange}
          >
            {(m: ModuleEntry) => (
              <ListView.Item id={m.name} textValue={m.name}>
                <ListView.ItemContent>
                  <div className="flex items-center justify-between w-full">
                    <ListView.Title className="font-mono text-xs">{m.name}</ListView.Title>
                    <Popover>
                      <Button isIconOnly variant="ghost" className="h-8 w-8 min-w-0">
                        <CircleInfo className="h-6 w-6" />
                      </Button>
                      <Popover.Content className="max-w-64">
                        <Popover.Dialog>
                          <Popover.Heading className="text-sm">{m.name}</Popover.Heading>
                          <p className="mt-1 text-xs text-default-500">{t('builder.moduleDesc')}</p>
                        </Popover.Dialog>
                      </Popover.Content>
                    </Popover>
                  </div>
                </ListView.ItemContent>
              </ListView.Item>
            )}
          </ListView>
        )}
      </Card>

      {historyLoading && <Spinner className="w-6 h-6 mx-auto mt-3" />}
    </>
  );
}
