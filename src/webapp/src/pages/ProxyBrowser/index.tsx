import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '@heroui/react';
import { ArrowLeft, ArrowRight, ArrowRotateLeft, ArrowRightToSquare, Plus } from '@gravity-ui/icons';
import { useAgent } from '../../contexts/AgentContext';
import { buildProxyUrl } from '../../api/proxy';

interface TabSession {
  id: string;
  urlInput: string;
  history: string[];
  historyIndex: number;
  src: string;
  loading: boolean;
}

function createTab(id: string): TabSession {
  return { id, urlInput: '', history: [], historyIndex: -1, src: '', loading: false };
}

export default function ProxyBrowserPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();

  const nextIdRef = useRef(1);
  const [tabs, setTabs] = useState<TabSession[]>(() => [createTab(String(nextIdRef.current++))]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]!.id);

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? tabs[0]!,
    [tabs, activeTabId],
  );

  const updateTab = useCallback((tabId: string, patch: Partial<TabSession>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...patch } : t));
  }, []);

  const navigate = useCallback((url: string) => {
    if (!agentId) return;
    const full = /^https?:\/\//i.test(url) ? url : `http://${url}`;
    const src = buildProxyUrl(agentId, full);
    const tabId = activeTab.id;
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const history = t.history.slice(0, t.historyIndex + 1);
      history.push(full);
      return { ...t, urlInput: full, src, history, historyIndex: history.length - 1, loading: true };
    }));
  }, [agentId, activeTab.id]);

  const handleGo = () => {
    if (!activeTab.urlInput.trim()) return;
    navigate(activeTab.urlInput.trim());
  };

  const handleBack = () => {
    if (activeTab.historyIndex <= 0) return;
    const url = activeTab.history[activeTab.historyIndex - 1]!;
    const tabId = activeTab.id;
    updateTab(tabId, { historyIndex: activeTab.historyIndex - 1, urlInput: url, src: buildProxyUrl(agentId!, url), loading: true });
  };

  const handleForward = () => {
    if (activeTab.historyIndex >= activeTab.history.length - 1) return;
    const url = activeTab.history[activeTab.historyIndex + 1]!;
    const tabId = activeTab.id;
    updateTab(tabId, { historyIndex: activeTab.historyIndex + 1, urlInput: url, src: buildProxyUrl(agentId!, url), loading: true });
  };

  const handleRefresh = () => {
    const url = activeTab.history[activeTab.historyIndex] ?? activeTab.urlInput;
    if (!url) return;
    updateTab(activeTab.id, { src: buildProxyUrl(agentId!, url), loading: true });
  };

  const addTab = () => {
    const id = String(nextIdRef.current++);
    setTabs(prev => [...prev, createTab(id)]);
    setActiveTabId(id);
  };

  const closeTab = (tabId: string) => {
    setTabs(prev => {
      if (prev.length <= 1) {
        return [createTab(String(nextIdRef.current++))];
      }
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (tabId === activeTabId) {
        setActiveTabId(next[Math.min(idx, next.length - 1)]!.id);
      }
      return next;
    });
  };

  if (!agentId) {
    return (
      <div className="text-center text-neutral-500 py-12">
        {t('proxyBrowser.selectAgent')}
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 10rem)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Button isIconOnly size="sm" variant="ghost" isDisabled={activeTab.historyIndex <= 0} onPress={handleBack} aria-label={t('proxyBrowser.back')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Button isIconOnly size="sm" variant="ghost" isDisabled={activeTab.historyIndex >= activeTab.history.length - 1} onPress={handleForward} aria-label={t('proxyBrowser.forward')}>
          <ArrowRight className="w-4 h-4" />
        </Button>
        <Button isIconOnly size="sm" variant="ghost" isDisabled={activeTab.historyIndex < 0} onPress={handleRefresh} aria-label={t('proxyBrowser.refresh')}>
          <ArrowRotateLeft className="w-4 h-4" />
        </Button>

        <Input variant="secondary"
          value={activeTab.urlInput}
          onChange={(e) => updateTab(activeTab.id, { urlInput: e.target.value })}
          placeholder={t('proxyBrowser.urlPlaceholder')}
          className="flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') handleGo(); }}
        />

        <Button size="sm" variant="primary" isDisabled={activeTab.loading || !activeTab.urlInput.trim()} onPress={handleGo}>
          <ArrowRightToSquare className="w-4 h-4" />
          <span className="ml-1">{t('proxyBrowser.go')}</span>
        </Button>
      </div>

      <div className="flex items-center gap-0.5 mb-3 overflow-x-auto scrollbar-thin">
        {tabs.map(tab => (
          <div key={tab.id} className="group flex items-center gap-1 cursor-pointer shrink-0 select-none px-3 py-1 rounded border border-transparent aria-selected:border-default-300"
            role="tab"
            aria-selected={tab.id === activeTabId}
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.loading && (
              <span className="inline-block w-3 h-3 border-2 border-current border-r-transparent rounded-full animate-spin" />
            )}
            <span className="truncate max-w-[140px] text-sm">{tab.urlInput || t('proxyBrowser.noTitle')}</span>
            <Button
              className="ml-auto w-4 h-4 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-300"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              aria-label={t('proxyBrowser.closeTab')}
              isIconOnly
              size="sm"
              variant="ghost"
            >
              ×
            </Button>
          </div>
        ))}
        <Button isIconOnly size="sm" variant="ghost" className="shrink-0 ml-0.5" onPress={addTab} aria-label={t('proxyBrowser.newTab')}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <Card className="flex-1 overflow-hidden">
        {activeTab.src ? (
          <iframe
            src={activeTab.src}
            title={activeTab.urlInput || 'Proxy Browser'}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
            onLoad={() => updateTab(activeTab.id, { loading: false })}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-400 text-sm">
            {t('proxyBrowser.urlPlaceholder')}
          </div>
        )}
      </Card>
    </div>
  );
}
