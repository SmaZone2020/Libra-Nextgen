import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@heroui/react';
import { ArrowLeft, ArrowRight, ArrowRotateLeft, ArrowRightToSquare } from '@gravity-ui/icons';
import { useAgent } from '../../contexts/AgentContext';
import { fetchPage } from '../../api/proxy';
import { getToken } from '../../api/client';
import { rewriteHtml } from './rewriter';
import type { ProxyHistoryEntry } from '../../types/models';

export default function ProxyBrowserPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();

  const [urlInput, setUrlInput] = useState('');
  const [history, setHistory] = useState<ProxyHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const currentEntry = historyIndex >= 0 ? history[historyIndex] : null;

  const navigateTo = useCallback(async (url: string, method = 'GET', body?: string, headers?: string) => {
    if (!agentId) return;
    let fullUrl = url;
    if (!/^http?:\/\//i.test(fullUrl)) {
      fullUrl = 'http://' + fullUrl;
    }

    setUrlInput(fullUrl);
    setLoading(true);
    setError(null);
    setStatusCode(null);

    try {
      const resp = await fetchPage(agentId, fullUrl, method, headers, body);
      if (resp.error) {
        setError(resp.error);
        setLoading(false);
        return;
      }

      setStatusCode(resp.status);

      const isHtml = /text\/html/i.test(resp.contentType);
      if (isHtml && resp.body) {
        // Decode base64 (handle both standard and URL-safe)
        let decoded: string;
        try {
          const binary = atob(resp.body);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          decoded = new TextDecoder().decode(bytes);
        } catch {
          decoded = resp.body; // fallback
        }

        const rewritten = rewriteHtml(decoded, agentId, resp.url, getToken());
        setHtmlContent(rewritten);

        // Extract title
        const titleMatch = decoded.match(/<title[^>]*>([^<]*)<\/title>/i);
        setPageTitle(titleMatch?.[1]?.trim() || resp.url);
      } else {
        // Non-HTML content — wrap in simple display
        if (/^image\//i.test(resp.contentType) && resp.body) {
          const imgSrc = `data:${resp.contentType};base64,${resp.body}`;
          setHtmlContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5;"><img src="${imgSrc}" style="max-width:100%;max-height:100vh;" alt="Image"></body></html>`);
        } else if (/^text\/(plain|json|xml|css|javascript)/i.test(resp.contentType) && resp.body) {
          const text = atob(resp.body);
          const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          setHtmlContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;font-family:monospace;white-space:pre-wrap;word-break:break-all;">${escaped}</body></html>`);
        } else {
          setHtmlContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#666;"><div style="text-align:center"><p>${resp.status} ${resp.statusText}</p><p style="font-size:14px">${resp.contentType}</p></div></body></html>`);
        }
        setPageTitle(resp.url);
      }

      // Update history
      const entry: ProxyHistoryEntry = {
        url: resp.url,
        title: pageTitle || resp.url,
        method,
        body,
        headers,
      };

      setHistory(prev => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(entry);
        return newHistory;
      });
      setHistoryIndex(prev => prev + 1);
    } catch {
      setError(t('proxyBrowser.fetchError'));
    } finally {
      setLoading(false);
    }
  }, [agentId, historyIndex, pageTitle, t]);

  const handleGo = () => {
    if (!urlInput.trim()) return;
    navigateTo(urlInput.trim());
  };

  const handleBack = () => {
    if (historyIndex <= 0) return;
    const entry = history[historyIndex - 1]!;
    setHistoryIndex(historyIndex - 1);
    setUrlInput(entry.url);
    navigateTo(entry.url, entry.method, entry.body, entry.headers);
  };

  const handleForward = () => {
    if (historyIndex >= history.length - 1) return;
    const entry = history[historyIndex + 1]!;
    setHistoryIndex(historyIndex + 1);
    setUrlInput(entry.url);
    navigateTo(entry.url, entry.method, entry.body, entry.headers);
  };

  const handleRefresh = () => {
    if (!currentEntry) return;
    navigateTo(currentEntry.url, currentEntry.method, currentEntry.body, currentEntry.headers);
  };

  // Listen for navigation messages from the iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      let data: { type: string; url: string; method?: string; body?: string; headers?: string };
      try { data = JSON.parse(e.data); } catch { return; }
      if (data.type === 'proxy-navigate' && data.url) {
        navigateTo(data.url, data.method || 'GET', data.body, data.headers);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [navigateTo]);

  if (!agentId) {
    return (
      <div className="text-center text-neutral-500 py-12">
        {t('proxyBrowser.selectAgent')}
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 10rem)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          isDisabled={historyIndex <= 0}
          onPress={handleBack}
          aria-label={t('proxyBrowser.back')}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          isDisabled={historyIndex >= history.length - 1}
          onPress={handleForward}
          aria-label={t('proxyBrowser.forward')}
        >
          <ArrowRight className="w-4 h-4" />
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          isDisabled={!currentEntry}
          onPress={handleRefresh}
          aria-label={t('proxyBrowser.refresh')}
        >
          <ArrowRotateLeft className="w-4 h-4" />
        </Button>

        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder={t('proxyBrowser.urlPlaceholder')}
          className="flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') handleGo(); }}
        />

        <Button
          size="sm"
          variant="primary"
          isDisabled={loading || !urlInput.trim()}
          onPress={handleGo}
        >
          <ArrowRightToSquare className="w-4 h-4" />
          <span className="ml-1">{t('proxyBrowser.go')}</span>
        </Button>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 text-xs text-neutral-500 mb-2 min-h-[20px]">
        {loading && <span>{t('proxyBrowser.loading')}</span>}
        {!loading && statusCode != null && (
          <span className={statusCode < 400 ? 'text-green-600' : 'text-red-500'}>
            HTTP {statusCode}
          </span>
        )}
        {!loading && pageTitle && (
          <span className="truncate">{pageTitle}</span>
        )}
        {!loading && error && (
          <span className="text-red-500">{error}</span>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 border border-neutral-200 rounded-lg overflow-hidden bg-white">
        {htmlContent ? (
          <iframe
            ref={iframeRef}
            sandbox="allow-scripts allow-same-origin allow-popups"
            srcDoc={htmlContent}
            title={pageTitle || 'Proxy Browser'}
            className="w-full h-full border-0"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-400 text-sm">
            {loading ? t('proxyBrowser.loading') : t('proxyBrowser.urlPlaceholder')}
          </div>
        )}
      </div>
    </div>
  );
}
