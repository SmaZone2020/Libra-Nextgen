import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowRotateLeft } from '@gravity-ui/icons';
import { getToken, setOnNetworkError, setOnNetworkRecovered, API_ORIGIN } from '../api/client';
import { consoleWs } from '../ws/consoleWs';

const API_BASE = `${API_ORIGIN}/api`;
const RETRY_INTERVAL = 10_000;
const MAX_RETRIES = 15;

export function NetworkOverlay() {
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
        const resp = await fetch(`${API_BASE}/agents?page=1&pageSize=1`, { headers });
        if (resp.ok) {
          clearTimers();
          setOffline(false);
          setOnNetworkRecovered(null); // clear after recovery
        }
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
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          <span className="text-3xl">{'⚠'}</span>
        </div>

        <h2 className="text-xl font-semibold text-neutral-900 mb-2">Connection Lost</h2>
        <p className="text-sm text-neutral-500 mb-6">
          Unable to reach the server. The connection has been interrupted.
        </p>

        {!gaveUp ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm text-neutral-400">
              <span className="inline-block w-4 h-4 border-2 border-neutral-300 border-t-blue-500 rounded-full animate-spin" />
              Retrying in {countdown}s
            </div>
            <p className="text-xs text-neutral-400">
              Attempt {retryCount + 1} / {MAX_RETRIES}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-red-500">
              All {MAX_RETRIES} attempts failed. The server may be down.
            </p>
            <Button color="primary" onPress={() => window.location.reload()}>
              <ArrowRotateLeft className="w-4 h-4" />
              Refresh Page
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
