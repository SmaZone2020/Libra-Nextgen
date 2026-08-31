'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Drawer, Input, Spinner, useOverlayState } from '@heroui/react';
import { SquarePlus } from '@gravity-ui/icons';
import {
  deleteAiSession,
  getAiProviders,
  getAiSessions,
  type AiProvider,
  type AiSession,
} from '../../api/ai';
import { getMyChannelSessions } from '../../api/aiChannels';
import { useDialog } from '../../hooks/useDialog';
import { AiSidebarSessionRow } from './AiSidebarSessionRow';

export interface AiSidebarProps {
  activeSessionId: string | null;
  refreshKey?: number;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onSessionCountChange?: (regularCount: number, channelCount: number) => void;
}

export function AiSidebar({
  activeSessionId,
  refreshKey = 0,
  onSelectSession,
  onNewSession,
  onSessionCountChange,
}: AiSidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { confirm, alert, DialogComponent } = useDialog();
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [channelSessions, setChannelSessions] = useState<AiSession[]>([]);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ss, cs, ps] = await Promise.all([getAiSessions(), getMyChannelSessions(), getAiProviders()]);
      setSessions(ss);
      setChannelSessions(cs);
      setProviders(ps);
      onSessionCountChange?.(ss.length, cs.length);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [onSessionCountChange]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const providerName = useMemo(() => {
    const map = new Map(providers.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? t('ai.unknownProvider');
  }, [providers, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  const filteredChannel = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channelSessions;
    return channelSessions.filter((s) => (s.channelExternalName ?? '').toLowerCase().includes(q));
  }, [channelSessions, query]);

  const sessionRow = (session: AiSession) => (
    <AiSidebarSessionRow
      key={session.id}
      session={session}
      active={session.id === activeSessionId}
      renaming={renamingId === session.id}
      renameValue={renameValue}
      deleting={deleting}
      providerName={providerName(session.providerId)}
      menuOpen={openMenuId === session.id}
      onMenuOpenChange={(open) => setOpenMenuId(open ? session.id : null)}
      onSelect={() => onSelectSession(session.id)}
      onStartRename={() => startRename(session)}
      onRenameValueChange={setRenameValue}
      onConfirmRename={() => void handleRename(session)}
      onCancelRename={() => setRenamingId(null)}
      onFork={() => void handleFork(session)}
      onDelete={() => void handleDelete(session)}
      channelType={session.channelType ?? null}
      channelExternalName={session.channelExternalName ?? null}
    />
  );

  const handleDelete = async (session: AiSession) => {
    const { confirmed } = await confirm(t('ai.deleteSessionConfirm'), t('ai.deleteSessionTitle'));
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteAiSession(session.id);
      if (activeSessionId === session.id) {
        onSelectSession('');
      }
      await load();
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const startRename = (session: AiSession) => {
    setRenamingId(session.id);
    setRenameValue(session.title);
  };

  const handleRename = async (session: AiSession) => {
    const title = renameValue.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    try {
      const { renameAiSession } = await import('../../api/ai');
      await renameAiSession(session.id, title);
      await load();
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    }
    setRenamingId(null);
  };

  const handleFork = async (session: AiSession) => {
    setDeleting(true);
    try {
      const { forkAiSession } = await import('../../api/ai');
      const fork = await forkAiSession(session.id);
      await load();
      onSelectSession(fork.id);
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const enabledProviders = providers.filter((p) => p.enabled);

  return (
    <>
      <div className="flex h-full min-h-0 p-0 flex-col overflow-hidden">
      <div className="py-3 sm:p-3 flex items-center gap-2">
        <Input
          className="flex-1 min-w-0"
          placeholder={t('ai.searchSessions')}
          value={query}
          variant='secondary'
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('ai.searchSessions')}
        />
        <Button
          className="aspect-square shrink-0 rounded-[15px]"
          variant="primary"
          isIconOnly
          onPress={() => {
            if (enabledProviders.length === 0) {
              navigate('/settings/ai');
              return;
            }
            onNewSession();
          }}
        >
          <SquarePlus className="size-4" />
        </Button>
      </div>

      {}
      <div className={`min-h-0 flex-1 overflow-y-auto pb-3 sm:px-3 px-0`}>
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size="sm" />
          </div>
        ) : filtered.length === 0 && filteredChannel.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted">
            NONE
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filtered.length > 0 && (
              <>
                {channelSessions.length > 0 && (
                  <div className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    {t('ai.consoleSessions')}
                  </div>
                )}
                {filtered.map(sessionRow)}
              </>
            )}
            {filteredChannel.length > 0 && (
              <>
                <div className="px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                  {t('ai.channelSessions')}
                </div>
                {filteredChannel.map(sessionRow)}
              </>
            )}
            {filtered.length === 0 && filteredChannel.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-muted">
                {t('ai.untitled')}
              </div>
            )}
          </div>
        )}
      </div>

      {enabledProviders.length === 0 && (
        <div className="shrink-0 border-t border-default-200 p-3 dark:border-default-800">
          <Button
            size="sm"
            variant="tertiary"
            className="w-full"
            onPress={() => navigate('/settings/ai')}
          >
            {t('ai.goConfigure')}
          </Button>
        </div>
      )}
      </div>
      {DialogComponent}
    </>
  );
}

export function AiSidebarDrawer({
  open,
  onOpenChange,
  ...sidebarProps
}: AiSidebarProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const state = useOverlayState({ isOpen: open, onOpenChange });

  return (
    <Drawer state={state}>
      <Drawer.Backdrop isDismissable>
        <Drawer.Content placement="left">
          <Drawer.Dialog className="px-4 w-60">
            <Drawer.Header>
              <Drawer.Heading>{t('ai.title')}</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body className="p-0">
              <AiSidebar {...sidebarProps} />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
