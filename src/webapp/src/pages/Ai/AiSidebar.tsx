'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Tooltip, Spinner } from '@heroui/react';
import { Magnifier, SquarePlus, TrashBin, Pencil } from '@gravity-ui/icons';
import {
  deleteAiSession,
  getAiProviders,
  getAiSessions,
  renameAiSession,
  type AiProvider,
  type AiSession,
} from '../../api/ai';

export interface AiSidebarProps {
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

export function AiSidebar({ activeSessionId, onSelectSession, onNewSession }: AiSidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ss, ps] = await Promise.all([getAiSessions(), getAiProviders()]);
      setSessions(ss);
      setProviders(ps);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providerName = useMemo(() => {
    const map = new Map(providers.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? t('ai.unknownProvider');
  }, [providers, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  const handleDelete = async (session: AiSession) => {
    if (!window.confirm(t('ai.deleteSessionConfirm'))) return;
    setDeleting(true);
    try {
      await deleteAiSession(session.id);
      if (activeSessionId === session.id) {
        onSelectSession('');
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const handleRename = async (session: AiSession) => {
    const title = renameValue.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    try {
      await renameAiSession(session.id, title);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
    setRenamingId(null);
  };

  const enabledProviders = providers.filter((p) => p.enabled);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* 新建会话与搜索 */}
      <div className="p-3 flex items-center gap-2">
        <Input
          className="flex-1 min-w-0"
          placeholder={t('ai.searchSessions')}
          value={query}
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

      {/* 会话列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size="sm" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted">
            {query ? t('common.noResults') : t('ai.noSessions')}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filtered.map((session) => {
              const active = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  className={`group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-default/60'
                  }`}
                  onClick={() => onSelectSession(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelectSession(session.id);
                  }}
                  role="button"
                  tabIndex={0}
                >
                {renamingId === session.id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      className="flex-1 min-w-0"
                      autoFocus
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRename(session);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                    <Button
                      className="aspect-square rounded-[15px]"
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
                  ) : (
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {session.title || t('ai.untitled')}
                      </span>
                      <span
                        className={`truncate text-[11px] ${
                          active ? 'text-primary-foreground/70' : 'text-muted'
                        }`}
                      >
                        {providerName(session.providerId)} · {session.model}
                      </span>
                    </div>
                  )}
                  {renamingId !== session.id && (
                    <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                      <Tooltip delay={0}>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          className={active ? 'text-primary-foreground' : ''}
                          aria-label={t('common.rename')}
                          onPress={() => {
                            setRenamingId(session.id);
                            setRenameValue(session.title);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Tooltip.Content>{t('common.rename')}</Tooltip.Content>
                      </Tooltip>
                      <Tooltip delay={0}>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          className={active ? 'text-primary-foreground' : 'text-danger'}
                          aria-label={t('common.delete')}
                          isDisabled={deleting}
                          onPress={() => void handleDelete(session)}
                        >
                          <TrashBin className="size-3.5" />
                        </Button>
                        <Tooltip.Content>{t('common.delete')}</Tooltip.Content>
                      </Tooltip>
                    </div>
                  )}
                </div>
              );
            })}
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
  );
}
