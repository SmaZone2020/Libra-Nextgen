import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Spinner } from '@heroui/react';
import { ListView } from '@components/list-view';
import { ArrowDownToLine, TrashBin } from '@gravity-ui/icons';
import type { BuildRecord, TemplateInfo } from '../../types/models';
import { PLATFORM_LABEL, STATUS_LABEL } from './constants';

interface BuilderHistoryPanelProps {
  building: boolean;
  buildStatus: string | null;
  error: string | null;
  history: BuildRecord[];
  templates: TemplateInfo[];
  historyLoading: boolean;
  templateUploading: boolean;
  onBuild: () => void;
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

const formatDate = (iso: string): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString();
};

export function BuilderHistoryPanel({
  building,
  buildStatus,
  error,
  history,
  templates,
  historyLoading,
  templateUploading,
  onBuild,
  onOpenInfo,
  onDownload,
  onDelete,
  onDeleteTemplate,
  onRebuildFromTemplate,
  onUploadTemplate,
}: BuilderHistoryPanelProps) {
  const { t } = useTranslation();
  const templateFileRef = useRef<HTMLInputElement>(null);

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUploadTemplate(file);
    if (templateFileRef.current) templateFileRef.current.value = '';
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
                      {' — '}
                      <span className={record.status === 'failed' ? 'text-danger' : record.status === 'building' ? 'text-primary' : 'text-success'}>
                        {t(STATUS_LABEL[record.status] || record.status)}
                      </span>
                    </span>
                  </ListView.Title>
                  <ListView.Description className="text-xs">
                    {formatDate(record.createdAt)}
                    {record.fileSize > 0 ? ` · ${formatSize(record.fileSize)}` : ''}
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
      {historyLoading && <Spinner className="w-6 h-6 mx-auto mt-3" />}
    </>
  );
}
