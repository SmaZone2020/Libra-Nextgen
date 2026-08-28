import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';
import { ArrowRotateLeft } from '@gravity-ui/icons';
import {
  getToken,
  pingBackend,
  getApiOrigin,
  setOnNetworkError,
  setOnNetworkRecovered,
  apiBase,
} from '../api/client';
import { consoleWs } from '../ws/consoleWs';

const RETRY_INTERVAL = 10_000;
const MAX_RETRIES = 15;

export function NetworkOverlay() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [countdown, setCountdown] = useState(RETRY_INTERVAL / 1000);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          <span className="text-3xl">{'⚠'}</span>
        </div>

        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">{t('network.title')}</h2>
        <p className="text-sm text-neutral-500 mb-6">{t('network.desc')}</p>

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
