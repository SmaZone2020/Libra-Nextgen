import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '@heroui/react';
import { ArrowLeft, ArrowRight, ArrowRotateLeft, ArrowRightToSquare, FolderPlus } from '@gravity-ui/icons';
import { useAgent } from '../../contexts/AgentContext';
import { fetchPage, API_BASE } from '../../api/proxy';
import { getToken } from '../../api/client';
import { rewriteHtml } from './rewriter';
import type { ProxyHistoryEntry } from '../../types/models';

interface TabSession {
  id: string;
  urlInput: string;
  history: ProxyHistoryEntry[];
  historyIndex: number;
  htmlContent: string;
  pageTitle: string;
  statusCode: number | null;
  error: string | null;
  loading: boolean;
}

function createTab(id: string): TabSession {
  return {
    id,
    urlInput: '',
    history: [],
    historyIndex: -1,
    htmlContent: '',
    pageTitle: '',
    statusCode: null,
    error: null,
    loading: false,
  };
}

export default function ProxyBrowserPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();

  const nextIdRef = useRef(1);
  const [tabs, setTabs] = useState<TabSession[]>(() => [createTab(String(nextIdRef.current++))]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]!.id);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? tabs[0]!,
    [tabs, activeTabId],
  );

  const apiBase = API_BASE;

  const updateTab = useCallback((tabId: string, patch: Partial<TabSession>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...patch } : t));
  }, []);

  const navigateTo = useCallback(async (url: string, method = 'GET', body?: string, headers?: string) => {
    const tabId = activeTabIdRef.current;
    if (!agentId) return;
    let fullUrl = url;
    if (!/^https?:\/\//i.test(fullUrl)) {
      fullUrl = 'http://' + fullUrl;
    }

    updateTab(tabId, { urlInput: fullUrl, loading: true, error: null, statusCode: null });

    try {
      const resp = await fetchPage(agentId, fullUrl, method, headers, body);
      if (resp.error) {
        updateTab(tabId, { error: resp.error, loading: false });
        return;
      }

      const isHtml = /text\/html/i.test(resp.contentType);

      // Extract title from response (not from state)
      let extractedTitle = resp.url;
      if (isHtml && resp.body) {
        let decoded: string;
        try {
          const binary = atob(resp.body);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          decoded = new TextDecoder().decode(bytes);
        } catch {
          decoded = resp.body;
        }
        const titleMatch = decoded.match(/<title[^>]*>([^<]*)<\/title>/i);
        extractedTitle = titleMatch?.[1]?.trim() || resp.url;
      }

      if (isHtml && resp.body) {
        let decoded: string;
        try {
          const binary = atob(resp.body);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          decoded = new TextDecoder().decode(bytes);
        } catch {
          decoded = resp.body;
        }

        const rewritten = rewriteHtml(decoded, agentId, resp.url, apiBase, getToken());

        const entry: ProxyHistoryEntry = {
          url: resp.url,
          title: extractedTitle,
          method,
          body,
          headers,
        };

        setTabs(prev => prev.map(t => {
          if (t.id !== tabId) return t;
          const newHistory = t.history.slice(0, t.historyIndex + 1);
          newHistory.push(entry);
          return {
            ...t,
            htmlContent: rewritten,
            pageTitle: extractedTitle,
            statusCode: resp.status,
            history: newHistory,
            historyIndex: newHistory.length - 1,
          };
        }));
      } else {
        // Non-HTML response
        let html = '';
        if (/^image\//i.test(resp.contentType) && resp.body) {
          const imgSrc = `data:${resp.contentType};base64,${resp.body}`;
          html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5;"><img src="${imgSrc}" style="max-width:100%;max-height:100vh;" alt="Image"></body></html>`;
        } else if (/^text\/(plain|json|xml|css|javascript)/i.test(resp.contentType) && resp.body) {
          const text = atob(resp.body);
          const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;font-family:monospace;white-space:pre-wrap;word-break:break-all;">${escaped}</body></html>`;
        } else {
          html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#666;"><div style="text-align:center"><p>${resp.status} ${resp.statusText}</p><p style="font-size:14px">${resp.contentType}</p></div></body></html>`;
        }

        const entry: ProxyHistoryEntry = {
          url: resp.url,
          title: extractedTitle,
          method,
          body,
          headers,
        };

        setTabs(prev => prev.map(t => {
          if (t.id !== tabId) return t;
          const newHistory = t.history.slice(0, t.historyIndex + 1);
          newHistory.push(entry);
          return {
            ...t,
            htmlContent: html,
            pageTitle: extractedTitle,
            statusCode: resp.status,
            history: newHistory,
            historyIndex: newHistory.length - 1,
          };
        }));
      }
    } catch {
      updateTab(tabId, { error: t('proxyBrowser.fetchError') });
    } finally {
      updateTab(tabId, { loading: false });
    }
  }, [agentId, apiBase, t, updateTab]);

  const handleGo = () => {
    if (!activeTab.urlInput.trim()) return;
    navigateTo(activeTab.urlInput.trim());
  };

  const handleBack = () => {
    if (activeTab.historyIndex <= 0) return;
    const entry = activeTab.history[activeTab.historyIndex - 1]!;
    const tabId = activeTab.id;
    updateTab(tabId, { historyIndex: activeTab.historyIndex - 1, urlInput: entry.url });
    navigateTo(entry.url, entry.method, entry.body, entry.headers);
  };

  const handleForward = () => {
    if (activeTab.historyIndex >= activeTab.history.length - 1) return;
    const entry = activeTab.history[activeTab.historyIndex + 1]!;
    const tabId = activeTab.id;
    updateTab(tabId, { historyIndex: activeTab.historyIndex + 1, urlInput: entry.url });
    navigateTo(entry.url, entry.method, entry.body, entry.headers);
  };

  const handleRefresh = () => {
    const entry = activeTab.history[activeTab.historyIndex] ?? null;
    if (!entry) return;
    navigateTo(entry.url, entry.method, entry.body, entry.headers);
  };

  const addTab = () => {
    const id = String(nextIdRef.current++);
    setTabs(prev => [...prev, createTab(id)]);
    setActiveTabId(id);
  };

  const closeTab = (tabId: string) => {
    setTabs(prev => {
      if (prev.length <= 1) {
        // Last tab: clear it instead of removing
        return [createTab(String(nextIdRef.current++))];
      }
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (tabId === activeTabIdRef.current) {
        const newActiveIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[newActiveIdx]!.id);
      }
      return next;
    });
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, tabId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveTabId(tabId);
    }
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
      <div className="flex items-center gap-2 mb-2">
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          isDisabled={activeTab.historyIndex <= 0}
          onPress={handleBack}
          aria-label={t('proxyBrowser.back')}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          isDisabled={activeTab.historyIndex >= activeTab.history.length - 1}
          onPress={handleForward}
          aria-label={t('proxyBrowser.forward')}
        >
          <ArrowRight className="w-4 h-4" />
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          isDisabled={activeTab.historyIndex < 0}
          onPress={handleRefresh}
          aria-label={t('proxyBrowser.refresh')}
        >
          <ArrowRotateLeft className="w-4 h-4" />
        </Button>

        <Input
          value={activeTab.urlInput}
          onChange={(e) => updateTab(activeTab.id, { urlInput: e.target.value })}
          placeholder={t('proxyBrowser.urlPlaceholder')}
          className="flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') handleGo(); }}
        />

        <Button
          size="sm"
          variant="primary"
          isDisabled={activeTab.loading || !activeTab.urlInput.trim()}
          onPress={handleGo}
        >
          <ArrowRightToSquare className="w-4 h-4" />
          <span className="ml-1">{t('proxyBrowser.go')}</span>
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 mb-2 overflow-x-auto scrollbar-thin">
        {tabs.map(tab => (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={tab.id === activeTabId}
            className={`group flex items-center gap-1 px-3 py-1.5 rounded-[20px] text-sm cursor-pointer border transition-colors shrink-0 select-none ${
              tab.id === activeTabId
                ? 'bg-white border-neutral-200 text-neutral-900 font-medium'
                : 'bg-neutral-100 border-transparent text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700'
            }`}
            onClick={() => setActiveTabId(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
          >
            {tab.loading && (
              <span className="inline-block w-3 h-3 border-2 border-current border-r-transparent rounded-full animate-spin" />
            )}
            <span className="truncate max-w-[140px]">
              {tab.pageTitle || t('proxyBrowser.noTitle')}
            </span>
            <button
              className="ml-0.5 w-4 h-4 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              aria-label={t('proxyBrowser.closeTab')}
              tabIndex={-1}
            >
              ×
            </button>
          </div>
        ))}
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className="shrink-0 ml-0.5"
          onPress={addTab}
          aria-label={t('proxyBrowser.newTab')}
        >
          <FolderPlus className="w-4 h-4" />
        </Button>
      </div>

      {/* Content area */}
      <Card className="flex-1 overflow-hidden">
        {activeTab.htmlContent ? (
          <iframe
            ref={iframeRef}
            sandbox="allow-scripts allow-forms"
            srcDoc={activeTab.htmlContent}
            title={activeTab.pageTitle || 'Proxy Browser'}
            className="w-full h-full border-0"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-400 text-sm">
            {activeTab.loading ? t('proxyBrowser.loading') : t('proxyBrowser.urlPlaceholder')}
          </div>
        )}
      </Card>
    </div>
  );
}
