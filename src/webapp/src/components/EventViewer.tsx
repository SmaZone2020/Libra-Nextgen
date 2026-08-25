import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Bell } from '@gravity-ui/icons';
import { consoleWs } from '../ws/consoleWs';
import { getRecentEvents, type EventItem } from '../api/events';
import { getEnabledEventTypes } from '../utils/eventTypes';

const KIND_LABEL: Record<string, string> = {
  agent: 'Agent',
  task: '任务',
  operator: '操作员',
  shell: 'Shell',
};

const KIND_COLOR: Record<string, string> = {
  agent: 'text-emerald-500',
  task: 'text-sky-500',
  operator: 'text-amber-500',
  shell: 'text-violet-500',
};

function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 全局事件流（页面 Header，移动端隐藏）。
 * 挂载时主动拉取历史（弥补 WS 回放时序丢失），订阅实时追加，
 * 按设置-首选项里选择的事件类型过滤。
 */
export function EventViewer() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 挂载时拉取事件历史（服务端 WS 回放可能在订阅前到达而丢失）
  useEffect(() => {
    let cancelled = false;
    getRecentEvents(50)
      .then((r) => {
        if (cancelled) return;
        setEvents((prev) => {
          const ids = new Set(prev.map((e) => e.id));
          const fresh = (r.events ?? []).filter((e) => !ids.has(e.id));
          return [...fresh, ...prev].slice(-200);
        });
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  // 订阅实时事件
  useEffect(() => {
    const off = consoleWs.on('event.item', (msg) => {
      const e = msg.data as unknown as EventItem;
      if (!e?.id || !e?.text) return;
      setEvents((prev) => [...prev.slice(-199), e]);

      const enabled = getEnabledEventTypes();
      if ((!enabled || enabled.has(e.kind)) && !open) setUnread((u) => u + 1);
    });
    return off;
  }, [open]);

  // 打开时清零未读并滚到底部
  useEffect(() => {
    if (open) {
      setUnread(0);
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [open, events]);

  // 按设置的事件类型过滤显示
  const visibleEvents = useMemo(() => {
    const enabled = getEnabledEventTypes();
    if (!enabled) return events;
    return events.filter((e) => enabled.has(e.kind));
  }, [events]);

  return (
    <div className="relative hidden md:block" ref={rootRef}>
      <Button isIconOnly size="sm" variant="ghost" onPress={() => setOpen((v) => !v)} aria-label="events">
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-h-[28rem] flex flex-col rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl z-50">
          <div className="px-3 py-2 text-sm font-medium border-b border-neutral-200 dark:border-neutral-700">
            事件流
          </div>
          <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1 text-sm">
            {visibleEvents.length === 0 ? (
              <div className="text-neutral-500 text-center py-8">暂无事件</div>
            ) : visibleEvents.map((e) => (
              <div key={e.id} className="flex gap-2 items-baseline">
                <span className={`shrink-0 text-xs font-medium ${KIND_COLOR[e.kind] ?? 'text-neutral-400'}`}>
                  [{KIND_LABEL[e.kind] ?? e.kind}]
                </span>
                <span className="shrink-0 text-xs text-neutral-400 tabular-nums">{fmtTime(e.ts)}</span>
                <span className="min-w-0 break-words">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
