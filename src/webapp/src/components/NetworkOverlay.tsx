import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Modal, TextField } from '@heroui/react';
import { ArrowRotateLeft, Check } from '@gravity-ui/icons';
import {
  getToken,
  pingBackend,
  setApiOrigin,
  getApiOrigin,
  hasCustomApiOrigin,
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
  const [testingUrl, setTestingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [inputValue, setInputValue] = useState(() => getApiOrigin());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetOriginRef = useRef(getApiOrigin());

  const clearTimers = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  };

  const stopOffline = (nextOrigin?: string) => {
    clearTimers();
    setOffline(false);
    setGaveUp(false);
    setRetryCount(0);
    // 恢复在线后清理恢复回调，避免重复触发
    setOnNetworkRecovered(null);
    if (nextOrigin) targetOriginRef.current = nextOrigin;
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

  // 临时切换后端地址：写入 localStorage（api_origin 键），立即重连
  const switchBackend = async (origin: string) => {
    const trimmed = origin.trim();
    setUrlError('');
    setTestingUrl(true);
    try {
      const ok = await pingBackend(trimmed);
      if (!ok) {
        setUrlError(t('network.switchFailed'));
        return;
      }
      setApiOrigin(trimmed);
      setInputValue(trimmed);
      stopOffline(trimmed);
      consoleWs.connect();
    } finally {
      setTestingUrl(false);
    }
  };

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

        {/* 断线临时改后端地址（存入浏览器 localStorage，等效首选项设置） */}
        <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4 text-left">
          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 mb-2">
            {t('network.switchBackend')}
          </p>
          <TextField
            variant="secondary"
            className="w-full"
            value={inputValue}
            onChange={(v) => { setInputValue(v); setUrlError(''); }}
          >
            <Label className="sr-only">{t('network.backendPlaceholder')}</Label>
            <Input placeholder={t('network.backendPlaceholder')} />
          </TextField>
          {urlError && <p className="mt-1 text-xs text-red-500">{urlError}</p>}
          <p className="mt-1 text-xs text-neutral-400">
            {t('network.switchHint')}
            {hasCustomApiOrigin() && (
              <span className="ml-1 text-accent">({t('network.switchStored')})</span>
            )}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              isDisabled={testingUrl || !inputValue.trim()}
              onPress={() => void switchBackend(inputValue)}
            >
              {testingUrl ? t('network.testing') : (
                <>
                  <Check className="w-3 h-3" />
                  {t('network.apply')}
                </>
              )}
            </Button>
            {hasCustomApiOrigin() && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setApiOrigin(null);
                  setInputValue(getApiOrigin());
                  setUrlError('');
                }}
              >
                {t('network.reset')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
