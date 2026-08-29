'use client';

import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Input, Label } from '@heroui/react';
import { CodeFork, EllipsisVertical, Pencil, TrashBin, Xmark } from '@gravity-ui/icons';
import type { AiSession } from '../../api/ai';

export interface AiSidebarSessionRowProps {
  session: AiSession;
  active: boolean;
  renaming: boolean;
  renameValue: string;
  deleting: boolean;
  providerName: string;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onSelect: () => void;
  onStartRename: () => void;
  onRenameValueChange: (value: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  onFork: () => void;
  onDelete: () => void;
  /** 频道会话徽标：telegram | lark | wechat-claw。 */
  channelType?: string | null;
  channelExternalName?: string | null;
}

const CHANNEL_ICONS: Record<string, string> = {
  telegram: '/icon/app/tg.png',
  lark: '/icon/app/lark.png',
  'wechat-claw': '/icon/app/wechat.png',
};

/** 会话列表行：点击切换；右侧三点按钮弹出 Dropdown 菜单（重命名/分支/删除）。 */
export function AiSidebarSessionRow({
  session,
  active,
  renaming,
  renameValue,
  deleting,
  providerName,
  menuOpen,
  onMenuOpenChange,
  onSelect,
  onStartRename,
  onRenameValueChange,
  onConfirmRename,
  onCancelRename,
  onFork,
  onDelete,
  channelType,
  channelExternalName,
}: AiSidebarSessionRowProps) {
  const { t } = useTranslation();
  const channelIcon = channelType ? CHANNEL_ICONS[channelType] : null;

  return (
    <div
      className={`group flex cursor-pointer select-none items-center gap-2 rounded-[20px] px-4 py-2 transition-colors ${
        active
          ? 'bg-accent text-white'
          : 'text-foreground hover:bg-default/60'
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect();
      }}
      role="button"
      tabIndex={0}
    >
      {renaming ? (
        <div className="flex items-center gap-1 select-none">
          <Input
            className="flex-1 min-w-0 sm:max-w-[170px] max-w-[150px]"
            autoFocus
            value={renameValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirmRename();
              if (e.key === 'Escape') onCancelRename();
            }}
          />
          <Button
            className="rounded-[15px]"
            size="sm"
            variant="ghost"
            isIconOnly
            onPress={onCancelRename}
          >
            <Xmark className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {session.title || t('ai.untitled')}
          </span>
          <span
            className={`flex items-center gap-1 truncate text-[11px] ${
              active ? 'text-primary-foreground/70' : 'text-muted'
            }`}
          >
            {channelIcon && (
              <img src={channelIcon} alt={channelType ?? ''} className="size-3.5 object-contain" />
            )}
            {channelType
              ? `${channelExternalName || session.title || t('ai.untitled')} · ${session.model}`
              : `${providerName} · ${session.model}`}
          </span>
        </div>
      )}

      {!renaming && (
        <Dropdown
          isOpen={menuOpen}
          onOpenChange={onMenuOpenChange}
        >
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={t('ai.moreActions')}
            className={`aspect-square rounded-[15px] ${
              active ? 'text-white hover:text-accent active:bg-white/20' : 'text-accent'
            }`}
          >
            <EllipsisVertical className="size-4" />
          </Button>
          <Dropdown.Popover>
            <Dropdown.Menu>
              <Dropdown.Item id="rename" textValue={t('ai.renameSession')} onPress={onStartRename}>
                <Pencil className="size-4 shrink-0 text-muted" />
                <Label>{t('ai.renameSession')}</Label>
              </Dropdown.Item>
              <Dropdown.Item id="fork" textValue={t('ai.forkSession')} onPress={onFork}>
                <CodeFork className="size-4 shrink-0 text-muted" />
                <Label>{t('ai.forkSession')}</Label>
              </Dropdown.Item>
              <Dropdown.Item id="delete" textValue={t('ai.deleteSession')} variant="danger" onPress={onDelete}>
                <TrashBin className="size-4 shrink-0 text-danger" />
                <Label>{t('ai.deleteSession')}</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      )}
    </div>
  );
}
