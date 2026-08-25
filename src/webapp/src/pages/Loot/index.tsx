import { useEffect, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { fetchLootContent, fmtSize, fmtTime, getLoot, type LootItem } from '../../api/loot';
import { useAgent } from '../../contexts/AgentContext';

export default function LootPage() {
  const { agentId } = useAgent();
  const [screens, setScreens] = useState<LootItem[]>([]);
  const [downloads, setDownloads] = useState<LootItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        getLoot(agentId || undefined, 'screenshot'),
        getLoot(agentId || undefined, 'download'),
      ]);
      setScreens(s.items);
      setDownloads(d.items);

      // 懒加载截图缩略图（仅对尚未加载的）
      for (const it of s.items) {
        if (thumbs[it.id]) continue;
        fetchLootContent(it.id)
          .then((url) => setThumbs((t) => ({ ...t, [it.id]: url })))
          .catch(() => { /* best-effort */ });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-medium">Loot 战利品</h2>
        <Chip size="sm" variant="soft">{agentId ? `Agent: ${agentId}` : '全部 Agent'}</Chip>
        <Button size="sm" variant="ghost" isDisabled={loading} onPress={load}>{loading ? '…' : '刷新'}</Button>
      </div>

      {/* 截图 Grid */}
      <div>
        <div className="text-sm text-neutral-400 mb-2">截图（{screens.length}）</div>
        {screens.length === 0 ? (
          <div className="text-center text-neutral-500 py-10 border border-dashed border-neutral-700 rounded-xl">
            暂无截图 —— 开启屏幕监控后，完整帧会自动存入 Loot
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {screens.map((s) => (
              <button
                key={s.id}
                type="button"
                className="group relative aspect-video rounded-lg overflow-hidden border border-neutral-800 bg-neutral-900 hover:border-neutral-600"
                onClick={() => setPreview(thumbs[s.id] ?? null)}
              >
                {thumbs[s.id] ? (
                  <img src={thumbs[s.id]} alt={s.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">
                    加载中…
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 px-2 py-1 text-[10px] text-white/80 bg-black/50 truncate">
                  {fmtTime(s.createdAt)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 下载登记表 */}
      <div>
        <div className="text-sm text-neutral-400 mb-2">下载登记（{downloads.length}）</div>
        {downloads.length === 0 ? (
          <div className="text-center text-neutral-500 py-8 border border-dashed border-neutral-700 rounded-xl">
            暂无下载记录
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-400">
                <th className="text-left py-2 px-2">文件名</th>
                <th className="text-left py-2 px-2">Agent</th>
                <th className="text-left py-2 px-2">大小</th>
                <th className="text-left py-2 px-2">时间</th>
              </tr>
            </thead>
            <tbody>
              {downloads.map((d) => (
                <tr key={d.id} className="border-b border-neutral-900">
                  <td className="py-2 px-2 break-all">{d.name}</td>
                  <td className="py-2 px-2"><Chip size="sm" variant="soft">{d.agentId}</Chip></td>
                  <td className="py-2 px-2 tabular-nums">{fmtSize(d.size)}</td>
                  <td className="py-2 px-2 tabular-nums text-neutral-400">{fmtTime(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 截图预览 overlay */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => setPreview(null)}
        >
          <img src={preview} alt="preview" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
