import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Dropdown, TextField, Input, Tooltip } from '@heroui/react';
import { FolderArrowLeft, FolderTree, Pencil } from '@gravity-ui/icons';
import { normalizePath, driveLabel } from '../../utils/path';

interface PathBarProps {
  path: string;
  drives: string[];
  historyLength: number;
  onGoBack: () => void;
  onGoUp: () => void;
  onDriveChange: (drive: string) => void;
  onNavigate: (path: string) => void;
}

/** Normalize a user-entered path: trim, unify separators, fix drive roots. */
export function PathBar({ path, drives, historyLength, onGoBack, onGoUp, onDriveChange, onNavigate }: PathBarProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const driveItems = useMemo(() => (drives ?? []).map(d => ({ id: d, label: d })), [drives]);

  const startEdit = () => {
    setDraft(path);
    setEditing(true);
  };

  const submit = () => {
    const normalized = normalizePath(draft);
    setEditing(false);
    if (normalized && normalized !== path) onNavigate(normalized);
  };

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
          {driveLabel(path)}
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            onAction={(key) => onDriveChange(String(key))}
            items={driveItems}
            aria-label={t('fileManager.selectDrive')}
          >
            {(item: { id: string; label: string }) => (
              <Dropdown.Item key={item.id} id={item.id} textValue={item.label}>
                {item.label}
              </Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <Card className='flex-1 min-w-0 py-0 h-[40px] rounded-[12px]'>
        {editing ? (
          <TextField
            aria-label={t('fileManager.pathInput')}
            variant="secondary"
            value={draft}
            onChange={setDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={submit}
            autoFocus
            className="w-full h-full [&_input]:font-mono [&_input]:text-xs"
          >
            <Input variant="secondary" className="h-full" />
          </TextField>
        ) : (
          <div
            className="flex items-center h-full px-3 cursor-text select-none font-mono text-xs truncate"
            onClick={startEdit}
            title={t('fileManager.pathInputHint')}
          >
            <span className="truncate">{path}</span>
            <Pencil className="w-3.5 h-3.5 ml-2 shrink-0 text-neutral-400" />
          </div>
        )}
      </Card>
    </div>
  );
}
