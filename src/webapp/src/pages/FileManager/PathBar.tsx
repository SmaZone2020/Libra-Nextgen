import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Dropdown, Tooltip } from '@heroui/react';
import { Breadcrumbs } from '@heroui/react/breadcrumbs';
import { FolderArrowLeft, FolderTree } from '@gravity-ui/icons';

interface PathBarProps {
  path: string;
  drives: string[];
  historyLength: number;
  onGoBack: () => void;
  onGoUp: () => void;
  onDriveChange: (drive: string) => void;
  onNavigate: (path: string) => void;
}

export function PathBar({ path, drives, historyLength, onGoBack, onGoUp, onDriveChange, onNavigate }: PathBarProps) {
  const { t } = useTranslation();

  const driveItems = useMemo(() => (drives ?? []).map(d => ({ id: d, label: d })), [drives]);

  const breadcrumbs = useMemo(() => {
    const parts = path.split('\\').filter(Boolean);
    if (parts.length === 0) return [{ label: path, path }];
    return parts.map((part, i) => ({
      label: part,
      path: parts.slice(0, i + 1).join('\\'),
    }));
  }, [path]);

  return (
    <div className="flex items-center gap-2 flex-wrap h-10">
      <Tooltip delay={0}>
        <Button isIconOnly className="rounded-[12px]" variant='tertiary' isDisabled={historyLength === 0} onPress={onGoBack}>
          <FolderArrowLeft className="w-4 h-4" />
        </Button>
        <Tooltip.Content>
          <p>{t('fileManager.goBack')}</p>
        </Tooltip.Content>
      </Tooltip>
      <Tooltip delay={0}>
        <Button isIconOnly className="rounded-[12px]" variant='tertiary' onPress={onGoUp}>
          <FolderTree className="w-4 h-4" />
        </Button>
        <Tooltip.Content>
          <p>{t('fileManager.goUp')}</p>
        </Tooltip.Content>
      </Tooltip>

      <Dropdown>
        <Button
          size="sm"
          variant="ghost"
          className="w-[80px] justify-start"
        >
          {path.split('\\')[0] + '\\'}
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            onAction={(key) => onDriveChange(String(key))}
            items={driveItems}
            aria-label={t('fileManager.selectDrive')}
          >
            {(item: { id: string; label: string }) => (
              <Dropdown.Item key={item.id} textValue={item.label}>
                {item.label}
              </Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <Card className='flex-1 min-w-0 py-0 h-[40px] rounded-[12px]'>
        <Breadcrumbs
          className='w-full h-full'
          onAction={(key) => {
            const idx = breadcrumbs.findIndex(c => c.path === key);
            if (idx >= 0 && idx < breadcrumbs.length - 1) {
              onNavigate(String(key));
            }
          }}
        >
          {breadcrumbs.map((crumb) => (
            <Breadcrumbs.Item key={crumb.path} id={crumb.path}>
              {crumb.label}
            </Breadcrumbs.Item>
          ))}
        </Breadcrumbs>
      </Card>
    </div>
  );
}
