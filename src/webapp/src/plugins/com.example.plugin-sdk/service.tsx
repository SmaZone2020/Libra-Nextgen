import { useCallback, useEffect, useState } from 'react';
import {
  Accordion, Alert, Button, Card, Chip, Input, Modal, Skeleton, Spinner, Switch, Table, TextArea,
} from '@heroui/react';
import { api } from '../../api/client';
import { callScript, tryParse, pretty } from './shared';
import { Tool } from './components';

// ── 4. 服务端脚本：全函数目录 + 实时调用 ──────────────────────────────

interface SdkManifest {
  pluginId: string;
  host: string;
  endpoint: string;
  callCount: number;
  funcs: { name: string; desc: string; options: { name: string; type: string; optional: boolean; default?: string; desc: string }[] }[];
}

export function ServiceTab() {
  const [manifest, setManifest] = useState<SdkManifest | null>(null);
  const [manifestErr, setManifestErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{ title: string; ok: boolean; data: unknown; error?: string } | null>(null);
  const [list, setList] = useState<{ pluginId: string; functions: string[] }[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  // 表单状态（每个函数的可选项）
  const [echoText, setEchoText] = useState('hello sdk');
  const [echoCount, setEchoCount] = useState('3');
  const [nowFormat, setNowFormat] = useState('yyyy-MM-dd HH:mm:ss');
  const [nowUtc, setNowUtc] = useState(false);
  const [skey, setSkey] = useState('abcdef0123456789');
  const [httpUrl, setHttpUrl] = useState('https://api.ipify.org?format=json');
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpHeaders, setHttpHeaders] = useState('{"X-Demo": "plugin-sdk"}');
  const [httpBody, setHttpBody] = useState('');
  const [httpTimeout, setHttpTimeout] = useState('15');
  const [fileName, setFileName] = useState('meta.json');
  const [listCount, setListCount] = useState('5');
  const [listPrefix, setListPrefix] = useState('item');
  const [tableRows, setTableRows] = useState('3');
  const [tablePrefix, setTablePrefix] = useState('sdk');
  const [failMsg, setFailMsg] = useState('demo failure');

  // 进入页面自动拉取 manifest（服务端脚本自描述）
  useEffect(() => {
    callScript<SdkManifest>('manifest').then((res) => {
      if (res.ok) {
        const parsed = tryParse(res.data);
        setManifest(parsed as SdkManifest);
      } else {
        setManifestErr(res.error ?? 'manifest 拉取失败');
      }
    }).catch((e: unknown) => setManifestErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const run = useCallback(async (fn: string, title: string, params?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await callScript(fn, params);
      setModal({ title: `${fn} — ${title}`, ok: res.ok, data: res.data, error: res.error });
    } catch (e) {
      setModal({ title, ok: false, data: null, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    setListErr(null);
    try {
      const res = await api.get<{ plugins: { pluginId: string; functions: string[] }[] }>('/plugin/list');
      setList(res.plugins);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* 运行方式 */}
      <Alert status="accent">
        <Alert.Content>
          <Alert.Title>如何驱动 service/*.cs（多文件拼接编译）</Alert.Title>
          <Alert.Description>
            POST /api/plugin/&lt;pluginId&gt;/&lt;fn&gt;，body 任意 JSON 会变成脚本函数的 p（dynamic）；
            返回 {'{ ok:true, data }'}；脚本抛异常返回 {'{ ok:false, error }'}。宿主把 service/ 下所有
            .cs 按文件名排序拼接为单个脚本编译，文件变更自动失效。
            函数是同步签名，内部可用 .GetAwaiter().GetResult() 等待异步（如 HttpClient）。
          </Alert.Description>
        </Alert.Content>
      </Alert>

      {/* 自描述目录 */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold">服务端函数目录（manifest 实时拉取）</h3>
          {busy && <Spinner size="sm" />}
          {manifest && <Chip size="sm" variant="secondary">已调用 {manifest.callCount} 次</Chip>}
        </div>
        {manifestErr && <p className="text-danger text-sm mb-2">{manifestErr}（服务端可能未重启/未启用插件）</p>}
        {manifest ? (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="script funcs" className="min-w-[720px]">
                <Table.Header>
                  <Table.Column isRowHeader>函数</Table.Column>
                  <Table.Column>说明</Table.Column>
                  <Table.Column>可选项（参数）</Table.Column>
                </Table.Header>
                <Table.Body>
                  {manifest.funcs.map((f, i) => (
                    <Table.Row key={f.name} id={`sf-${i}`}>
                      <Table.Cell><code className="font-mono text-xs">{f.name}</code></Table.Cell>
                      <Table.Cell className="text-sm">{f.desc}</Table.Cell>
                      <Table.Cell className="text-sm text-default-500">
                        {f.options.length === 0 ? <span className="text-default-400">无</span> : (
                          <div className="flex flex-wrap gap-1">
                            {f.options.map((o) => (
                              <Chip key={o.name} size="sm" variant={o.optional ? 'soft' : 'secondary'}>
                                {o.name}{o.optional ? (o.default ? `=${o.default}` : '?') : '*'}
                              </Chip>
                            ))}
                          </div>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        )}
      </Card>

      {/* 逐个函数演练 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">逐个函数演练（每个函数 = 一个能力点）</h3>
        <Accordion className="w-full">
          <Tool title="echo — 动态参数访问" desc="body 任意字段以 p.字段 读取，支持嵌套"
            fields={(
              <div className="flex flex-wrap gap-2">
                <Input value={echoText} onChange={(e) => setEchoText((e.target as HTMLInputElement).value)} placeholder="text" className="w-48" />
                <Input value={echoCount} onChange={(e) => setEchoCount((e.target as HTMLInputElement).value)} placeholder="count" className="w-24" />
              </div>
            )}
            run={() => run('echo', '参数原样回显', { text: echoText, count: Number(echoCount) || 0, nested: { deep: [1, 2, 3], ok: true } })} />
          <Tool title="now — 时间格式化" desc="可选项 format / utc"
            fields={(
              <div className="flex flex-wrap items-end gap-2">
                <Input value={nowFormat} onChange={(e) => setNowFormat((e.target as HTMLInputElement).value)} placeholder="format" className="w-56" />
                <Switch isSelected={nowUtc} onChange={setNowUtc}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                  <span className="text-sm">UTC</span>
                </Switch>
              </div>
            )}
            run={() => run('now', '时间格式化', { format: nowFormat, utc: nowUtc ? 1 : 0 })} />
          <Tool title="bkn — 签名计算" desc="纯数学计算（bkn/g_tk 算法），可选项 skey"
            fields={(
              <Input value={skey} onChange={(e) => setSkey((e.target as HTMLInputElement).value)} placeholder="skey" className="w-64" />
            )}
            run={() => run('bkn', 'bkn 计算', { skey })} />
          <Tool title="state — 跨调用内存状态" desc="静态字段随脚本编译缓存保留（服务重启清零）"
            fields={null}
            run={() => run('state', '状态演示', {})} />
          <Tool title="ip — 服务端网络请求" desc="GET 外网 IP（服务端发起，无 CORS）"
            fields={null}
            run={() => run('ip', '外网 IP', {})} />
          <Tool title="http — 通用 HTTP 请求" desc="可选项 url / method / headers / body / timeoutSec"
            fields={(
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Input value={httpUrl} onChange={(e) => setHttpUrl((e.target as HTMLInputElement).value)} placeholder="url" className="w-96" />
                  <Input value={httpMethod} onChange={(e) => setHttpMethod((e.target as HTMLInputElement).value)} placeholder="method" className="w-24" />
                  <Input value={httpTimeout} onChange={(e) => setHttpTimeout((e.target as HTMLInputElement).value)} placeholder="timeoutSec" className="w-24" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <TextArea value={httpHeaders} onChange={(e) => setHttpHeaders((e.target as HTMLTextAreaElement).value)} placeholder='headers JSON，如 {"X-Demo":"1"}' rows={2} className="w-96" />
                  <TextArea value={httpBody} onChange={(e) => setHttpBody((e.target as HTMLTextAreaElement).value)} placeholder="body JSON（POST/PUT 时发送）" rows={2} className="w-96" />
                </div>
              </div>
            )}
            run={() => {
              let headers: Record<string, unknown> | undefined;
              let body: unknown;
              try { headers = httpHeaders.trim() ? JSON.parse(httpHeaders) : undefined; } catch { /* 原样忽略 */ }
              try { body = httpBody.trim() ? JSON.parse(httpBody) : undefined; } catch { body = httpBody; }
              run('http', 'HTTP 请求', { url: httpUrl, method: httpMethod, headers, body, timeoutSec: Number(httpTimeout) || 15 });
            }} />
          <Tool title="file — 读取包内文件" desc="数据/配置随 zip 分发，脚本按插件目录定位"
            fields={(
              <Input value={fileName} onChange={(e) => setFileName((e.target as HTMLInputElement).value)} placeholder="包内相对路径" className="w-64" />
            )}
            run={() => run('file', '包内文件', { name: fileName })} />
          <Tool title="list — 返回数组" desc="可选项 count / prefix"
            fields={(
              <div className="flex flex-wrap gap-2">
                <Input value={listCount} onChange={(e) => setListCount((e.target as HTMLInputElement).value)} placeholder="count" className="w-24" />
                <Input value={listPrefix} onChange={(e) => setListPrefix((e.target as HTMLInputElement).value)} placeholder="prefix" className="w-32" />
              </div>
            )}
            run={() => run('list', '数组返回', { count: Number(listCount) || 5, prefix: listPrefix })} />
          <Tool title="table — 返回对象数组" desc="前端 Table 直接渲染，可选项 rows / prefix"
            fields={(
              <div className="flex flex-wrap gap-2">
                <Input value={tableRows} onChange={(e) => setTableRows((e.target as HTMLInputElement).value)} placeholder="rows" className="w-24" />
                <Input value={tablePrefix} onChange={(e) => setTablePrefix((e.target as HTMLInputElement).value)} placeholder="prefix" className="w-32" />
              </div>
            )}
            run={() => run('table', '表格数据', { rows: Number(tableRows) || 3, prefix: tablePrefix })} />
          <Tool title="fail — 抛异常（错误契约）" desc="宿主统一转 { ok:false, error }"
            fields={(
              <Input value={failMsg} onChange={(e) => setFailMsg((e.target as HTMLInputElement).value)} placeholder="message" className="w-64" />
            )}
            run={() => run('fail', '错误契约', { message: failMsg })} />
        </Accordion>
      </Card>

      {/* 已启用插件的服务端脚本列表 */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-semibold">GET /api/plugin/list — 已导入且含 service/*.cs 的插件</h3>
          <Button size="sm" variant="secondary" onPress={loadList}>加载</Button>
        </div>
        {listErr && <p className="text-danger text-sm mb-2">{listErr}</p>}
        {list && (
          list.length === 0 ? (
            <p className="text-sm text-default-500">没有插件带 service/*.cs。</p>
          ) : (
            <div className="divide-y divide-default-100">
              {list.map((p) => (
                <div key={p.pluginId} className="py-2 flex items-center gap-2 flex-wrap">
                  <code className="font-mono text-xs">{p.pluginId}</code>
                  {p.functions.map((f) => <Chip key={f} size="sm" variant="soft">{f}</Chip>)}
                </div>
              ))}
            </div>
          )
        )}
      </Card>

      {/* 结果模态框 */}
      <Modal.Backdrop isOpen={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading className="font-mono text-base">{modal?.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {modal && (
                <div className="space-y-3">
                  <Alert status={modal.ok ? 'success' : 'danger'}>
                    <Alert.Content>
                      <Alert.Title>{modal.ok ? '调用成功' : '调用失败'}</Alert.Title>
                      {modal.error && (
                        <>
                          <Alert.Description>{modal.error}</Alert.Description>
                          {!modal.ok && (
                            <p className="text-xs text-default-500 mt-1">
                              提示：请求 body 在 callScript 里统一以 <code className="font-mono">{'{'}params ?? {'{}'}{'}'}</code>
                              发送；服务端把 body 反序列化为 dynamic <code className="font-mono">p</code> 传给脚本函数。
                              报 “does not contain a definition” 是脚本里访问了 body 里不存在的字段名 —— 检查演练表单
                              参数名是否与函数期望一致（见上方函数目录）。
                            </p>
                          )}
                        </>
                      )}
                    </Alert.Content>
                  </Alert>
                  <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-default-50 dark:bg-default-900 p-3 rounded max-h-[60vh] overflow-auto">
                    {pretty(modal.data)}
                  </pre>
                </div>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
