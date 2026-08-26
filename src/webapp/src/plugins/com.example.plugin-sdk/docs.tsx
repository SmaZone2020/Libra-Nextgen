import { useCallback, useEffect, useState } from 'react';
import { Alert, Skeleton, Tabs } from '@heroui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DOC_FILES, assetUrl } from './shared';

/**
 * markdown 渲染样式（prose 自定义，避免引入 @tailwindcss/typography）：
 *  - 代码块：边框 + 圆角 + 深底 + 横向滚动
 *  - 行内代码：浅底圆角
 *  - 列表：外框 + 圆角 + 缩进（嵌套列表去边框避免嵌套盒）
 *  - 表格：全边框 + 表头底色
 *  - 引用/分割线/链接/图片均有样式
 */
const MD_STYLE = [
  'max-w-none text-sm leading-relaxed space-y-3',
  // 标题
  '[&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold',
  '[&_h1]:mt-5 [&_h1]:mb-2 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:mt-4 [&_h3]:mb-1',
  '[&_h1]:pb-1 [&_h2]:pb-1 [&_h1]:border-b [&_h1]:border-default-200 [&_h2]:border-b [&_h2]:border-default-200',
  // 段落 / 行内代码
  '[&_p]:my-2',
  '[&_code]:font-mono [&_code]:text-[12px] [&_code]:bg-default-100 [&_code]:dark:bg-default-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:border [&_code]:border-default-200 [&_code]:dark:border-default-700',
  // 代码块：整体有边框底，内层 code 去掉行内样式
  '[&_pre]:my-3 [&_pre]:bg-default-50 [&_pre]:dark:bg-default-900 [&_pre]:border [&_pre]:border-default-200 [&_pre]:dark:border-default-700 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-auto',
  '[&_pre]:shadow-sm [&_pre]:text-[12px] [&_pre]:font-mono [&_pre]:leading-relaxed',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:border-none [&_pre_code]:text-inherit',
  // 列表：外框 + 圆角 + 间距；嵌套列表去掉外框避免叠盒
  '[&_ul]:my-3 [&_ul]:border [&_ul]:border-default-200 [&_ul]:dark:border-default-700 [&_ul]:rounded-lg [&_ul]:py-2 [&_ul]:pl-6 [&_ul]:pr-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:bg-default-50/50 [&_ul]:dark:bg-default-900/30',
  '[&_ol]:my-3 [&_ol]:border [&_ol]:border-default-200 [&_ol]:dark:border-default-700 [&_ol]:rounded-lg [&_ol]:py-2 [&_ol]:pl-6 [&_ol]:pr-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:bg-default-50/50 [&_ol]:dark:bg-default-900/30',
  '[&_li]:my-0.5 [&_li]:leading-relaxed [&_li]:pl-1',
  '[&_ul_ul]:border-none [&_ul_ul]:bg-transparent [&_ul_ul]:my-1 [&_ul_ul]:pl-4 [&_ul_ul]:dark:bg-transparent',
  '[&_ol_ol]:border-none [&_ol_ol]:bg-transparent [&_ol_ol]:my-1 [&_ol_ol]:pl-4 [&_ol_ol]:dark:bg-transparent',
  '[&_ul_ol]:border-none [&_ul_ol]:bg-transparent [&_ul_ol]:my-1 [&_ul_ol]:pl-4 [&_ul_ol]:dark:bg-transparent',
  '[&_ol_ul]:border-none [&_ol_ul]:bg-transparent [&_ol_ul]:my-1 [&_ol_ul]:pl-4 [&_ol_ul]:dark:bg-transparent',
  // 表格：全边框 + 表头底色 + 分隔线
  '[&_table]:w-full [&_table]:text-xs [&_table]:border-collapse [&_table]:my-3 [&_table]:border [&_table]:border-default-200 [&_table]:dark:border-default-700 [&_table]:rounded-lg [&_table]:overflow-hidden',
  '[&_th]:text-left [&_th]:border [&_th]:border-default-200 [&_th]:dark:border-default-700 [&_th]:bg-default-100 [&_th]:dark:bg-default-800 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-default-200 [&_td]:dark:border-default-700 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top',
  // 引用 / 分割线 / 链接 / 图片 / 粗体
  '[&_blockquote]:my-3 [&_blockquote]:border-l-3 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-default-500 [&_blockquote]:bg-default-50/50 [&_blockquote]:dark:bg-default-900/30 [&_blockquote]:rounded-r-lg [&_blockquote]:py-1',
  '[&_hr]:my-4 [&_hr]:border-default-200 [&_hr]:dark:border-default-700',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-primary/80',
  '[&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-default-200 [&_img]:my-3',
  '[&_strong]:font-semibold',
].join(' ');

// ── 2. 文档：活文档在线渲染 ───────────────────────────────────────────

export function DocsTab() {
  const [docId, setDocId] = useState(DOC_FILES[0]?.id ?? '01');
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id: string) => {
    const doc = DOC_FILES.find((d) => d.id === id);
    if (!doc) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(assetUrl(doc.file));
      if (!res.ok) throw new Error(`加载失败：HTTP ${res.status}`);
      setMd(await res.text());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMd(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(docId);
  }, [docId, load]);

  return (
    <div className="space-y-4">
      <Alert status="accent">
        <Alert.Content>
          <Alert.Title>活文档（随 zip 分发）</Alert.Title>
          <Alert.Description>
            六篇 markdown 存放在插件包 <code className="font-mono text-xs">assets/docs/</code>，
            经 <code className="font-mono text-xs">/api/plugins/com.example.plugin-sdk/assets/docs/&lt;file&gt;</code>
            在线拉取渲染（react-markdown + remark-gfm）。文档只写一份，页面与仓库共用 ——
            改文档 → 重新打包 → 刷新页面即可，无需重建前端。
          </Alert.Description>
        </Alert.Content>
      </Alert>

      <Tabs className="w-full" orientation="vertical" variant="secondary" selectedKey={docId} onSelectionChange={(k) => { if (k) setDocId(String(k)); }}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="活文档目录">
            {DOC_FILES.map((d) => (
              <Tabs.Tab key={d.id} id={d.id}>
                <span className="font-mono">{d.id}</span> {d.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>

        {DOC_FILES.map((d) => (
          <Tabs.Panel key={d.id} id={d.id} className="px-4 min-w-0">
            <h3 className="mb-2 font-semibold">{d.id} · {d.label}</h3>
            <p className="text-sm text-muted mb-3">
              来源：<code className="font-mono text-xs">assets/docs/{d.file.replace('docs/', '')}</code>
            </p>
            {loading && (
              <div className="space-y-2">
                <Skeleton className="h-8 rounded-lg w-1/2" />
                <Skeleton className="h-5 rounded-lg" />
                <Skeleton className="h-5 rounded-lg w-3/4" />
                <Skeleton className="h-5 rounded-lg w-1/2" />
              </div>
            )}
            {err && <p className="text-danger text-sm">{err}（服务端未重启/插件未启用/包内缺 docs？）</p>}
            {md !== null && !loading && (
              <article className={MD_STYLE}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
              </article>
            )}
          </Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
}
