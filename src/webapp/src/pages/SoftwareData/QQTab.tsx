import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Skeleton } from '@heroui/react';
import { PersonPlus, Eye, EyeSlash, ArrowRotateLeft } from '@gravity-ui/icons';
import { getQQ, getQQPortrait, getQQClientKey } from '../../api/othersoft';
import type { QQAccount, QQPortrait, QQClientKeyItem } from '../../types/models';

interface QQTabProps {
  agentId: string;
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

export function QQTab({ agentId }: QQTabProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<QQAccount[]>([]);
  const [portraits, setPortraits] = useState<Record<string, QQPortrait | null>>({});
  const [clientkeys, setClientkeys] = useState<QQClientKeyItem[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getQQ(agentId);
      const list = res.accounts ?? [];
      setAccounts(list);

      if (list.length > 0) {
        try {
          const qqList = list.map(a => a.number);
          const data = await getQQPortrait(qqList);
          const map: Record<string, QQPortrait | null> = {};
          for (const acc of list) {
            map[acc.number] = data[acc.number] ?? null;
          }
          setPortraits(map);
        } catch { /* portrait API unavailable */ }
      }

      try {
        const ck = await getQQClientKey(agentId);
        setClientkeys(ck.items ?? []);
      } catch { /* clientkey unavailable */ }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }

  if (accounts.length === 0 && clientkeys.length === 0) {
    return <div className="text-center text-neutral-500 py-8">{t('othersoft.noAccounts')}</div>;
  }

  return (
    <div className="space-y-3">
      {accounts.map(acc => {
        const p = portraits[acc.number];
        return (
          <Card key={acc.number} className="p-3">
            <div className="flex items-center gap-3">
              {p?.avatar ? (
                <img src={`http://q1.qlogo.cn/g?b=qq&nk=${acc.number}&s=100`} alt={p.nickname} className="w-10 h-10 rounded-full shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-neutral-200 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{p?.nickname || acc.number}</div>
                <div className="text-xs text-neutral-500">{acc.number}</div>
              </div>
            </div>
          </Card>
        );
      })}

      {clientkeys.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <Chip size="sm" variant="soft" color="accent">
              {t('othersoft.qqClientKey.itemsFound', { count: clientkeys.length })}
            </Chip>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" isIconOnly aria-label={t('othersoft.qqClientKey.show')} onPress={() => setShowRaw(s => !s)}>
                {showRaw ? <EyeSlash className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button size="sm" variant="ghost" isIconOnly aria-label={t('othersoft.qqClientKey.refresh')} onPress={fetchData}>
                <ArrowRotateLeft className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {clientkeys.map(ck => (
            <div key={`${ck.pid}:${ck.uin}`} className="flex items-center gap-3 py-1.5 border-t border-default-100 first:border-t-0">
              <div className="w-24 shrink-0 text-sm font-medium">{ck.uin || '—'}</div>
              <div className="flex-1 min-w-0">
                <span className="font-mono text-xs break-all" title={showRaw ? ck.clientkey : maskKey(ck.clientkey)}>
                  {showRaw ? ck.clientkey : maskKey(ck.clientkey)}
                </span>
              </div>
              <div className="text-xs text-neutral-500 shrink-0">PID {ck.pid}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
