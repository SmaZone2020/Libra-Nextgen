import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Skeleton } from '@heroui/react';
import { PersonPlus } from '@gravity-ui/icons';
import { getQQ, getQQPortrait } from '../../api/othersoft';
import type { QQAccount, QQPortrait } from '../../types/models';

interface QQTabProps {
  agentId: string;
}

export function QQTab({ agentId }: QQTabProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<QQAccount[]>([]);
  const [portraits, setPortraits] = useState<Record<string, QQPortrait | null>>({});
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
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
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }

  if (accounts.length === 0) {
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
                <img src={p.avatar} alt={p.nickname} className="w-10 h-10 rounded-full shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-neutral-200 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{p?.nickname || acc.number}</div>
                <div className="text-xs text-neutral-500">{acc.number}</div>
              </div>
              <Button
                size="sm"
                variant="flat"
                color="success"
                startContent={<PersonPlus className="w-4 h-4" />}
                onPress={() => window.open(`https://wpa.qq.com/msgrd?v=3&uin=${acc.number}&site=qq&menu=yes`, '_blank')}
              >
                {t('othersoft.addFriend')}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
