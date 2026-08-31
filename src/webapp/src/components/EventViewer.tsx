import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Drawer } from '@heroui/react';
import { Bell } from '@gravity-ui/icons';
import { consoleWs } from '../ws/consoleWs';
import { getRecentEvents, type EventItem } from '../api/events';
import { getEnabledEventTypes } from '../utils/eventTypes';

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

export function EventViewer() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (open) {
      setUnread(0);
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [open, events]);

  const visibleEvents = useMemo(() => {
    const enabled = getEnabledEventTypes();
    if (!enabled) return events;
    return events.filter((e) => enabled.has(e.kind));
  }, [events]);

  const { t } = useTranslation();
  const KIND_LABEL: Record<string, string> = {
    agent: 'Agent',
    task: t('eventViewer.eventTask'),
    operator: t('eventViewer.eventOperator'),
    shell: 'Shell',
  };

  return (
    <div className="hidden md:block">
      <Drawer isOpen={open} onOpenChange={setOpen}>
        <Button isIconOnly size="sm" variant="ghost" className="relative" aria-label="events">
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
        <Drawer.Backdrop>
          <Drawer.Content placement="left" >
            <Drawer.Dialog className='sm:w-[70%] w-full'>
              <Drawer.Header>
                <Drawer.Heading>{t('eventViewer.title')}</Drawer.Heading>
              </Drawer.Header>
              <Drawer.Body>
                <div ref={listRef} className="h-full overflow-y-auto p-2 space-y-1 text-sm">
                  {visibleEvents.length === 0 ? (
                    <div className="text-neutral-500 text-center py-8">{t('eventViewer.empty')}</div>
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
              </Drawer.Body>
              <Drawer.Footer>
                <Button slot="close" variant="secondary">{t('eventViewer.close')}</Button>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}
