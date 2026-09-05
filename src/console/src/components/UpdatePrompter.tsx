'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Spinner } from '@heroui/react';
import Markdown from 'react-markdown';
import { checkForUpdate, getUpdateStatus } from '../api/system';
import type { ServerUpdateState } from '../api/system';
import type { UpdateProgress } from '../desktop/DesktopTopBar';
import { isLibraDesktopShell } from '../desktop/DesktopTopBar';

const SKIP_VERSION_KEY = 'libra.update.skip_version';
const OPEN_EVENT = 'libra:open-update';

/**
 * Global "new version available" prompt. On login it quietly checks the
 * cached update state (server caches GitHub lookups for 15 min) and shows the
 * modal once per session when a newer release exists and the version was not
 * skipped. Manual triggers (About page) force a fresh check via
 * `libra:open-update`.
 *
 * Buttons:
 *  - later: close, remind again next session
 *  - skip this version: remember the tag, never auto-prompt until a newer one
 *  - update now: download the new backend + webapp payload inside the desktop
 *    shell with live progress pushed over IPC; the shell restarts the local
 *    service and reloads the page when finished. Browsers cannot install —
 *    they get guidance + the release page link instead.
 */
export function UpdatePrompter() {
  const { t } = useTranslation();
  const desktopShell = isLibraDesktopShell();
  const bridge = window.libraDesktop;

  const [status, setStatus] = useState<ServerUpdateState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canDownload = desktopShell && !!bridge?.runUpdate;

  const showState = (s: ServerUpdateState) => {
    setStatus(s);
    setError(null);
    setProgress(null);
    setBusy(false);
    setOpen(true);
  };

  // Auto prompt once per session (skip honored).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await getUpdateStatus();
        if (!alive || !s.updateAvailable || !s.latestTag) return;
        let skipped = '';
        try { skipped = localStorage.getItem(SKIP_VERSION_KEY) ?? ''; } catch { /* ignore */ }
        if (skipped === s.latestTag) return;
        showState(s);
      } catch {
        // Update checks are best-effort (server may disable them / be offline).
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual trigger from the About page / anywhere: force a fresh check.
  useEffect(() => {
    const handler = async () => {
      try {
        showState(await checkForUpdate());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (busy) return;
    setOpen(false);
  };

  const handleSkip = () => {
    if (status?.latestTag) {
      try { localStorage.setItem(SKIP_VERSION_KEY, status.latestTag); } catch { /* ignore */ }
    }
    setOpen(false);
  };

  const handleUpdate = async () => {
    if (!status || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (canDownload && bridge?.runUpdate && bridge.onUpdateProgress) {
        const unsubscribe = bridge.onUpdateProgress((p) => setProgress(p));
        const result = await bridge.runUpdate();
        if (!result.ok) setError(result.error ?? t('update.failed', { error: 'unknown' }));
        unsubscribe();
        // On success the shell restarts the service and reloads the page;
        // this component unmounts with the old document.
      } else {
        // Plain browser: no install path from here.
        setError(t('update.unavailable'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // On desktop success the shell reloads the page; setting busy false
      // here is harmless either way.
      setBusy(false);
    }
  };

  const percent =
    progress?.phase === 'download' && progress.total && progress.total > 0
      ? Math.min(100, Math.round(((progress.received ?? 0) / progress.total) * 100))
      : null;

  if (!status?.updateAvailable) return null;

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Modal.Container placement="center" size="md">
        <Modal.Dialog>
          {!busy && <Modal.CloseTrigger />}
          <Modal.Header>
            <Modal.Heading>{t('update.title')}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-default-500">
                {t('update.from', { current: status.current ?? '?' })}
              </span>
              <span aria-hidden="true">→</span>
              <span className="font-semibold">
                {t('update.to', { latest: status.latestTag })}
              </span>
              {status.publishedAt && (
                <span className="text-xs text-default-400">
                  {t('update.published', {
                    date: new Date(status.publishedAt).toLocaleDateString(),
                  })}
                </span>
              )}
            </div>

            {status.notes && (
              <div className="max-h-64 overflow-y-auto rounded-2xl border border-default-200/70 bg-black/[0.02] p-4 text-[13px] leading-relaxed dark:border-default-800 dark:bg-white/[0.03]">
                <p className="mb-2 font-semibold">{t('update.notes')}</p>
                <div className="prose prose-neutral dark:prose-invert max-w-none prose-sm">
                  <Markdown>{status.notes}</Markdown>
                </div>
              </div>
            )}

            {busy && progress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-default-500">
                  <span>
                    {percent !== null
                      ? t('update.phaseDownload', { percent })
                      : t(`update.phase.${progress.phase}`)}
                  </span>
                  {progress.phase === 'download' && percent === null && (
                    <Spinner size="sm" color="accent" />
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-default-200 dark:bg-default-800">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{
                      width: percent !== null ? `${percent}%` : '100%',
                      opacity: percent !== null ? 1 : 0.4,
                    }}
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
                {status.htmlUrl && (
                  <a
                    href={status.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 inline-block underline underline-offset-2"
                  >
                    {t('update.openRelease')}
                  </a>
                )}
              </p>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" isDisabled={busy} onPress={close}>
              {t('update.later')}
            </Button>
            <Button variant="outline" isDisabled={busy} onPress={handleSkip}>
              {t('update.skipVersion')}
            </Button>
            <Button variant="primary" isDisabled={!canDownload} isPending={busy} onPress={() => void handleUpdate()}>
              {t('update.now')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
