import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, TextField } from '@heroui/react';
import { ArrowRotateLeft } from '@gravity-ui/icons';
import {
  getToken,
  pingBackend,
  getApiOrigin,
  setApiOriginOverride,
  setOnNetworkError,
  setOnNetworkRecovered,
  apiBase,
} from '../api/client';
import { consoleWs } from '../ws/consoleWs';
import { isLibraDesktopShell } from '../desktop/DesktopTopBar';

const RETRY_INTERVAL = 10_000;
const MAX_RETRIES = 15;

export function NetworkOverlay({
  initiallyOffline = false,
  onRecovered,
}: {
  /** Start already offline (used at app boot when the backend is unreachable). */
  initiallyOffline?: boolean;
  /** Called when connectivity comes back and the overlay hides itself. */
  onRecovered?: () => void;
} = {}) {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(initiallyOffline);
  const [gaveUp, setGaveUp] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [countdown, setCountdown] = useState(RETRY_INTERVAL / 1000);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // In the desktop shell the backend address is derived from the shell config
  // (127.0.0.1:<configured port>), so the manual address form is pointless
  // there — restarting the local service is the right recovery action.
  const desktopShell = isLibraDesktopShell();
  const bridge = window.libraDesktop;
  const shellCanRestart = desktopShell && !!bridge?.restartService;

  // Backend address override form (plain web deployments only)
  const [originDraft, setOriginDraft] = useState('');
  const [savingOrigin, setSavingOrigin] = useState(false);
  const [originError, setOriginError] = useState<string | null>(null);

  // Sync the draft with the effective origin each time we go offline.
  useEffect(() => {
    if (offline) {
      setOriginDraft(getApiOrigin());
      setOriginError(null);
    }
  }, [offline]);

  const handleApplyOrigin = async () => {
    const raw = originDraft.trim();
    if (!raw) {
      setOriginError(t('network.invalidOrigin'));
      return;
    }
    // Allow scheme-less input ("host:5270") by defaulting to http.
    const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      setOriginError(t('network.invalidOrigin'));
      return;
    }
    setSavingOrigin(true);
    setOriginError(null);
    try {
      const ok = await pingBackend(parsed.origin);
      if (!ok) {
        setOriginError(t('network.unreachableOrigin'));
        setSavingOrigin(false);
        return;
      }
      setApiOriginOverride(parsed.origin);
      window.location.reload();
    } catch {
      setOriginError(t('network.unreachableOrigin'));
      setSavingOrigin(false);
    }
  };

  const clearTimers = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  };

  const stopOffline = () => {
    clearTimers();
    setOffline(false);
    setGaveUp(false);
    setRetryCount(0);
    setOnNetworkRecovered(null);
    onRecovered?.();
  };

  const startRetry = () => {
    setRetryCount(0);
    setGaveUp(false);
    setCountdown(RETRY_INTERVAL / 1000);

    countdownRef.current = setInterval(() => {
      setCountdown(prev => prev <= 1 ? RETRY_INTERVAL / 1000 : prev - 1);
    }, 1000);

    timerRef.current = setInterval(async () => {
      setRetryCount(prev => {
        const next = prev + 1;
        if (next >= MAX_RETRIES) {
          clearTimers();
          setGaveUp(true);
          return next;
        }
        return next;
      });

      try {
        const headers: Record<string, string> = {};
        const token = getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const resp = await fetch(`${apiBase()}/agents?page=1&pageSize=1`, { headers });
        if (resp.ok) stopOffline();
      } catch { /* still offline */ }
    }, RETRY_INTERVAL);
  };

  useEffect(() => {
    setOnNetworkError(() => {
      setOffline(true);
      consoleWs.disconnect();
      clearTimers();
      startRetry();
    });

    // Boot-time offline: show the overlay immediately and start retrying.
    if (initiallyOffline) {
      consoleWs.disconnect();
      startRetry();
    }

    return () => {
      clearTimers();
      setOnNetworkError(null);
      setOnNetworkRecovered(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offline) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" role="alert">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">

        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">{t('network.title')}</h2>
        <p className="text-sm text-neutral-500 mb-6">{t('network.desc')}</p>

        {desktopShell ? (
          <div className="mb-6 space-y-2 text-left">
            <div className="text-xs font-medium text-neutral-400">{t('network.backend')}</div>
            <p className="text-sm text-neutral-500">
              <code className="font-mono">{getApiOrigin()}</code>
            </p>
            {shellCanRestart && (
              <Button
                variant="secondary"
                size="lg"
                className="mt-1 w-full rounded-[15px]"
                isDisabled={savingOrigin}
                onPress={async () => {
                  setSavingOrigin(true);
                  try {
                    await bridge!.restartService?.();
                    setSavingOrigin(false);
                  } catch {
                    setSavingOrigin(false);
                  }
                }}
              >
                <ArrowRotateLeft className="size-4" />
                {savingOrigin ? t('common.loading') : t('network.restartLocal')}
              </Button>
            )}
          </div>
        ) : (
          /* Change the backend address without leaving the page (web only) */
          <div className="mb-6 space-y-2 text-left">
            <div className="text-xs font-medium text-neutral-400">{t('network.backend')}</div>
            <div className="flex items-center gap-2">
              <TextField
                value={originDraft}
                onChange={setOriginDraft}
                variant="secondary"
                className="min-w-0 flex-1"
                aria-label={t('network.backend')}
              >
                <Input variant="secondary" placeholder="http://host:5270" />
              </TextField>
              <Button
                variant="secondary"
                size="lg"
                className="shrink-0 rounded-[15px]"
                isDisabled={savingOrigin || originDraft.trim() === getApiOrigin()}
                onPress={() => void handleApplyOrigin()}
              >
                {savingOrigin ? t('common.loading') : t('network.apply')}
              </Button>
            </div>
            {originError && (
              <p className="text-xs text-red-500" role="alert">{originError}</p>
            )}
          </div>
        )}

        {!gaveUp ? (
          <div className="space-y-2 mb-6">
            <div className="flex items-center justify-center gap-2 text-sm text-neutral-400">
              <span className="inline-block w-4 h-4 border-2 border-neutral-300 border-t-blue-500 rounded-full animate-spin" />
              {t('network.retrying', { seconds: countdown })}
            </div>
            <p className="text-xs text-neutral-400">
              {t('network.attempt', { current: retryCount + 1, total: MAX_RETRIES })}
            </p>
            <p className="text-xs text-neutral-400">
              {t('network.backend')}：<code className="font-mono">{getApiOrigin()}</code>
            </p>
          </div>
        ) : (
          <div className="space-y-4 mb-6">
            <p className="text-sm text-red-500">{t('network.gaveUp')}</p>
            <Button variant="primary" onPress={() => window.location.reload()}>
              <ArrowRotateLeft className="w-4 h-4" />
              {t('network.refresh')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
