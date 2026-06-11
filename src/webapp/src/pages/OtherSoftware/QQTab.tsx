import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Chip, Skeleton } from '@heroui/react';
import { getQQ, getQQInfo } from '../../api/othersoft';
import type { QQAccount, QQUserInfo } from '../../types/models';

interface QQTabProps {
  agentId: string;
}

function LevelIcons({ icons }: { icons: QQUserInfo['qq_level_icons'] }) {
  if (!icons) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs">
      {icons.crownNum > 0 && (
        <span className="text-amber-500" title={`${icons.crownNum} crowns`}>
          {'\u{1F451}'}
        </span>
      )}
      {icons.sunNum > 0 && (
        <span className="text-amber-400" title={`${icons.sunNum} suns`}>
          {'☀'.repeat(Math.min(icons.sunNum, 3))}
        </span>
      )}
      {icons.moonNum > 0 && (
        <span className="text-blue-400" title={`${icons.moonNum} moons`}>
          {'\u{1F31B}'.repeat(Math.min(icons.moonNum, 3))}
        </span>
      )}
      {icons.starNum > 0 && (
        <span className="text-yellow-400" title={`${icons.starNum} stars`}>
          {'⭐'.repeat(Math.min(icons.starNum, 3))}
        </span>
      )}
    </span>
  );
}

export function QQTab({ agentId }: QQTabProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<QQAccount[]>([]);
  const [infos, setInfos] = useState<Record<string, QQUserInfo | null>>({});
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await getQQ(agentId);
      const list = res.accounts ?? [];
      setAccounts(list);

      // Fetch user info for each QQ account in parallel
      const results = await Promise.all(
        list.map(async (acc) => {
          try {
            const info = await getQQInfo(agentId, acc.number);
            return { number: acc.number, info };
          } catch {
            return { number: acc.number, info: null as QQUserInfo | null };
          }
        })
      );
      const map: Record<string, QQUserInfo | null> = {};
      for (const r of results) map[r.number] = r.info;
      setInfos(map);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return <div className="text-center text-neutral-500 py-8">{t('othersoft.noAccounts')}</div>;
  }

  return (
    <div className="space-y-3">
      {accounts.map(acc => {
        const info = infos[acc.number];
        return (
          <Card key={acc.number} className="p-4">
            <div className="flex items-start gap-4">
              {/* Avatar */}
              {info?.avatar_url ? (
                <img
                  src={info.avatar_url}
                  alt={info.nick || acc.number}
                  className="w-16 h-16 rounded-full shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-neutral-200 shrink-0" />
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-base">
                    {info?.nick || info?.nickname || acc.number}
                  </span>
                  {info?.sex && (
                    <Chip
                      size="sm"
                      color={info.sex === 'male' ? 'accent' : 'danger'}
                    >
                      {info.sex === 'male' ? '♂' : '♀'}
                    </Chip>
                  )}
                  {info?.age != null && info.age > 0 && (
                    <span className="text-xs text-neutral-500">{info.age}{t('common.age')}</span>
                  )}
                </div>

                <div className="text-sm text-neutral-500 mt-0.5">
                  QQ: {acc.number}
                  {info?.qid && <span className="ml-2">QID: {info.qid}</span>}
                </div>

                {/* QQ Level */}
                {info && (
                  <div className="flex items-center gap-2 mt-1">
                    <Chip size="sm" variant="primary">
                      LV {info.qq_level}
                    </Chip>
                    <LevelIcons icons={info.qq_level_icons} />
                  </div>
                )}

                {/* Location & Reg Time */}
                {info && (
                  <div className="flex items-center gap-3 mt-1 text-xs text-neutral-400">
                    {info.location && <span>{info.location}</span>}
                    {info.reg_time && (
                      <span>
                        {t('othersoft.regTime')}: {info.reg_time.slice(0, 10)}
                      </span>
                    )}
                  </div>
                )}

                {/* VIP Badges */}
                {info && (info.is_vip || info.is_svip || info.is_big_club || info.is_years_vip) && (
                  <div className="flex items-center gap-1 mt-2">
                    {info.is_svip && (
                      <Chip size="sm" className="bg-amber-500 text-white">SVIP{info.vip_level}</Chip>
                    )}
                    {info.is_vip && !info.is_svip && (
                      <Chip size="sm" color="danger">VIP{info.vip_level}</Chip>
                    )}
                    {info.is_years_vip && (
                      <Chip size="sm" color="warning">年费</Chip>
                    )}
                    {info.is_big_club && (
                      <Chip size="sm" className="bg-violet-500 text-white">大会员{info.big_club_level}</Chip>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
