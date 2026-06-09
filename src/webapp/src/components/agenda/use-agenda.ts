'use client';

import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocale } from 'react-aria-components/I18nProvider';
import type { CalendarDateTime } from '@internationalized/date';
import {
  CalendarDate,
  DateFormatter,
  getLocalTimeZone,
  isSameDay,
  startOfWeek,
  today,
} from '@internationalized/date';
import { useControlledState } from '@react-stately/utils';
import { agendaVariants } from './agenda.styles';

export interface AgendaEvent {
  id: string;
  title: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  color?: string;
  isAllDay?: boolean;
  isReadOnly?: boolean;
  status?: 'confirmed' | 'unconfirmed';
}

export type AgendaView = 'day' | 'week' | 'month';

export interface UseAgendaOptions {
  events: AgendaEvent[];
  defaultView?: AgendaView;
  view?: AgendaView;
  onViewChange?: (view: AgendaView) => void;
  defaultDate?: CalendarDate;
  date?: CalendarDate;
  onDateChange?: (date: CalendarDate) => void;
  startHour?: number;
  endHour?: number;
  slotDuration?: number;
  weekDays?: number;
  onEventCreate?: (event: {
    start: CalendarDateTime;
    end: CalendarDateTime;
  }) => void;
  onEventDelete?: (id: string) => void;
  onEventMove?: (
    id: string,
    start: CalendarDateTime,
    end: CalendarDateTime
  ) => void;
  onEventResize?: (
    id: string,
    start: CalendarDateTime,
    end: CalendarDateTime
  ) => void;
  onEventSelect?: (id: string | null) => void;
  selectedEventId?: string | null;
  defaultSelectedEventId?: string | null;
}

export interface AllDayLayoutItem {
  event: AgendaEvent;
  colStart: number;
  colSpan: number;
  row: number;
}

export interface MonthRowLayoutItem {
  event: AgendaEvent;
  colStart: number;
  colSpan: number;
  row: number;
}

export interface MonthRowLayout {
  items: MonthRowLayoutItem[];
  rowCount: number;
  rowCountPerCol: number[];
}

export interface DropPreview {
  dateStr: string;
  topPx?: number;
  heightPx?: number;
  color?: string;
}

export interface DragState {
  type: 'idle' | 'creating' | 'moving' | 'resizing';
  eventId?: string;
  startY?: number;
  currentY?: number;
  dayColumnDate?: CalendarDate;
  originalEvent?: AgendaEvent;
}

export interface UseAgendaReturn {
  view: AgendaView;
  date: CalendarDate;
  selectedEventId: string | null;
  events: AgendaEvent[];
  startHour: number;
  endHour: number;
  slotDuration: number;
  goToNext: () => void;
  goToPrevious: () => void;
  goToToday: () => void;
  setView: (view: AgendaView) => void;
  setDate: (date: CalendarDate) => void;
  selectEvent: (id: string | null) => void;
  visibleDays: CalendarDate[];
  visibleWeeks: CalendarDate[][];
  allDayEvents: AgendaEvent[];
  allDayLayout: AllDayLayoutItem[];
  allDayCountPerDay: number[];
  isAllDayExpanded: boolean;
  toggleAllDayExpanded: () => void;
  getEventsForDay: (date: CalendarDate) => AgendaEvent[];
  getEventLayout: (eventId: string) => {
    columnIndex: number;
    totalColumns: number;
  };
  getAllEventsForDay: (date: CalendarDate) => AgendaEvent[];
  getMonthRowLayout: (week: CalendarDate[]) => MonthRowLayout;
  getPerCellEvents: (day: CalendarDate, week: CalendarDate[]) => AgendaEvent[];
  heading: string;
  slots: ReturnType<typeof agendaVariants>;
  onEventCreate?: (event: {
    start: CalendarDateTime;
    end: CalendarDateTime;
  }) => void;
  onEventDelete?: (id: string) => void;
  onEventMove?: (
    id: string,
    start: CalendarDateTime,
    end: CalendarDateTime
  ) => void;
  onEventResize?: (
    id: string,
    start: CalendarDateTime,
    end: CalendarDateTime
  ) => void;
  dragState: DragState;
  setDragState: React.Dispatch<React.SetStateAction<DragState>>;
  dropPreview: DropPreview | null;
  setDropPreview: React.Dispatch<React.SetStateAction<DropPreview | null>>;
  timeZone: string;
  locale: string;
}

interface EventLayoutEntry {
  columnIndex: number;
  totalColumns: number;
}

export function useAgenda(options: UseAgendaOptions): UseAgendaReturn {
  const {
    defaultDate,
    defaultSelectedEventId = null,
    defaultView = 'week',
    endHour = 24,
    events,
    onDateChange,
    onEventCreate,
    onEventDelete,
    onEventMove,
    onEventResize,
    onEventSelect,
    slotDuration = 60,
    startHour = 0,
    weekDays = 7,
  } = options;

  const { locale } = useLocale();
  const timeZone = getLocalTimeZone();
  const fallbackDate = defaultDate ?? today(timeZone);

  const [view, setView] = useControlledState(
    options.view,
    defaultView,
    options.onViewChange
  );
  const [date, setDate] = useControlledState(
    options.date,
    fallbackDate,
    onDateChange
  );
  const [selectedEventId, selectEventRaw] = useControlledState(
    options.selectedEventId,
    defaultSelectedEventId,
    onEventSelect
  );
  const [dragState, setDragState] = useState<DragState>({ type: 'idle' });
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);

  const headingFormatterRef = useRef<DateFormatter | null>(null);

  const slots = useMemo(() => agendaVariants({ view }), [view]);

  const visibleDays = useMemo<CalendarDate[]>(() => {
    if (view === 'day') return [date];
    if (view === 'week') {
      if (weekDays >= 7) {
        const start = startOfWeek(date, locale);
        const days: CalendarDate[] = [];
        for (let i = 0; i < 7; i++) days.push(start.add({ days: i }));
        return days;
      }
      const half = Math.floor(weekDays / 2);
      const days: CalendarDate[] = [];
      for (let i = -half; i < weekDays - half; i++)
        days.push(date.add({ days: i }));
      return days;
    }
    return [];
  }, [view, date, locale, weekDays]);

  const visibleWeeks = useMemo<CalendarDate[][]>(() => {
    if (view !== 'month') return [];
    const firstOfMonth = date.set({ day: 1 });
    const weeks: CalendarDate[][] = [];
    let cursor = startOfWeek(firstOfMonth, locale);
    for (let w = 0; w < 6; w++) {
      const week: CalendarDate[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(cursor);
        cursor = cursor.add({ days: 1 });
      }
      weeks.push(week);
    }
    return weeks;
  }, [view, date, locale]);

  const getEventsForDay = useCallback(
    (d: CalendarDate) =>
      events.filter((e) => !e.isAllDay && isSameDay(e.start, d)),
    [events]
  );

  const eventLayoutMap = useMemo<Map<string, EventLayoutEntry>>(() => {
    const map = new Map<string, EventLayoutEntry>();
    const timedEvents = events.filter((e) => !e.isAllDay);

    const toMinutes = (dt: CalendarDateTime) =>
      1440 * dt.day +
      44640 * dt.month +
      525600 * dt.year +
      60 * dt.hour +
      dt.minute;

    const overlaps = (a: AgendaEvent, b: AgendaEvent) => {
      const aStart = toMinutes(a.start);
      const aEnd = toMinutes(a.end);
      const bStart = toMinutes(b.start);
      return aStart < toMinutes(b.end) && bStart < aEnd;
    };

    const visited = new Set<string>();

    for (const seed of timedEvents) {
      if (visited.has(seed.id)) continue;
      const group: AgendaEvent[] = [seed];
      visited.add(seed.id);

      let changed = true;
      while (changed) {
        changed = false;
        for (const e of timedEvents) {
          if (visited.has(e.id)) continue;
          if (group.some((g) => overlaps(g, e))) {
            group.push(e);
            visited.add(e.id);
            changed = true;
          }
        }
      }

      group.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
      const columns: AgendaEvent[][] = [];

      for (const evt of group) {
        let placed = false;
        for (let col = 0; col < columns.length; col++) {
          const last = columns[col][columns[col].length - 1];
          if (toMinutes(last.end) <= toMinutes(evt.start)) {
            columns[col].push(evt);
            map.set(evt.id, { columnIndex: col, totalColumns: 0 });
            placed = true;
            break;
          }
        }
        if (!placed) {
          columns.push([evt]);
          map.set(evt.id, { columnIndex: columns.length - 1, totalColumns: 0 });
        }
      }

      for (const evt of group) {
        const entry = map.get(evt.id);
        if (entry) entry.totalColumns = columns.length;
      }
    }

    return map;
  }, [events]);

  const getEventLayout = useCallback(
    (eventId: string) =>
      eventLayoutMap.get(eventId) ?? { columnIndex: 0, totalColumns: 1 },
    [eventLayoutMap]
  );

  const getAllEventsForDay = useCallback(
    (d: CalendarDate) => events.filter((e) => isSameDay(e.start, d)),
    [events]
  );

  const getMonthRowLayout = useCallback(
    (week: CalendarDate[]): MonthRowLayout => {
      if (week.length === 0)
        return { items: [], rowCount: 0, rowCountPerCol: [] };

      const weekStart = week[0];
      const weekEnd = week[week.length - 1];

      const spanning = events.filter((ev) => {
        if (!ev.isAllDay) return false;
        const evStart = new CalendarDate(
          ev.start.year,
          ev.start.month,
          ev.start.day
        );
        const evEnd = new CalendarDate(ev.end.year, ev.end.month, ev.end.day);
        if (evEnd.compare(weekStart) < 0 || evStart.compare(weekEnd) > 0)
          return false;

        const clampedStart =
          evStart.compare(weekStart) < 0 ? weekStart : evStart;
        const clampedEnd = evEnd.compare(weekEnd) > 0 ? weekEnd : evEnd;

        let startCol = -1;
        for (let i = 0; i < week.length; i++) {
          if (isSameDay(week[i], clampedStart)) {
            startCol = i;
            break;
          }
        }
        let endCol = startCol;
        for (
          let i = startCol;
          i < week.length && week[i].compare(clampedEnd) <= 0;
          i++
        ) {
          endCol = i;
        }
        return endCol - startCol >= 1;
      });

      const items: MonthRowLayoutItem[] = [];
      const rowEnds: number[] = [];

      for (const ev of spanning) {
        const evStart = new CalendarDate(
          ev.start.year,
          ev.start.month,
          ev.start.day
        );
        const evEnd = new CalendarDate(ev.end.year, ev.end.month, ev.end.day);
        const clampedStart =
          evStart.compare(weekStart) < 0 ? weekStart : evStart;
        const clampedEnd = evEnd.compare(weekEnd) > 0 ? weekEnd : evEnd;

        let colStart = 0;
        for (let i = 0; i < week.length; i++) {
          if (isSameDay(week[i], clampedStart)) {
            colStart = i;
            break;
          }
        }
        let colEnd = colStart;
        for (
          let i = colStart;
          i < week.length && week[i].compare(clampedEnd) <= 0;
          i++
        ) {
          colEnd = i;
        }
        const colSpan = colEnd - colStart + 1;

        let row = 0;
        for (
          row = 0;
          row < rowEnds.length && !(rowEnds[row] < colStart);
          row++
        ) {
          // find first available row
        }
        rowEnds[row] = colStart + colSpan - 1;
        items.push({ colSpan, colStart, event: ev, row });
      }

      const rowCountPerCol = new Array<number>(week.length).fill(0);
      for (const item of items) {
        for (let c = item.colStart; c < item.colStart + item.colSpan; c++) {
          rowCountPerCol[c] = Math.max(rowCountPerCol[c], item.row + 1);
        }
      }

      return { items, rowCount: rowEnds.length, rowCountPerCol };
    },
    [events]
  );

  const getPerCellEvents = useCallback(
    (day: CalendarDate, week: CalendarDate[]): AgendaEvent[] => {
      const layout = getMonthRowLayout(week);
      const spanningIds = new Set(layout.items.map((i) => i.event.id));
      return events.filter((ev) => {
        if (spanningIds.has(ev.id)) return false;
        const evStart = new CalendarDate(
          ev.start.year,
          ev.start.month,
          ev.start.day
        );
        const evEnd = new CalendarDate(ev.end.year, ev.end.month, ev.end.day);
        return evStart.compare(day) <= 0 && evEnd.compare(day) >= 0;
      });
    },
    [events, getMonthRowLayout]
  );

  const allDayEvents = useMemo<AgendaEvent[]>(
    () => events.filter((e) => e.isAllDay),
    [events]
  );

  const allDayLayout = useMemo<AllDayLayoutItem[]>(() => {
    if (visibleDays.length === 0) return [];

    const items: AllDayLayoutItem[] = [];
    const rowEnds: number[] = [];
    const visStart = visibleDays[0];
    const visEnd = visibleDays[visibleDays.length - 1];

    for (const ev of allDayEvents) {
      const evStart = new CalendarDate(
        ev.start.year,
        ev.start.month,
        ev.start.day
      );
      const evEnd = new CalendarDate(ev.end.year, ev.end.month, ev.end.day);
      const clampedStart = evStart.compare(visStart) < 0 ? visStart : evStart;
      const clampedEnd = evEnd.compare(visEnd) > 0 ? visEnd : evEnd;

      if (clampedStart.compare(visEnd) > 0 || clampedEnd.compare(visStart) < 0)
        continue;

      let colStart = -1;
      for (let i = 0; i < visibleDays.length; i++) {
        if (isSameDay(visibleDays[i], clampedStart)) {
          colStart = i;
          break;
        }
      }
      if (colStart === -1) continue;

      let colEnd = colStart;
      for (
        let i = colStart;
        i < visibleDays.length && visibleDays[i].compare(clampedEnd) <= 0;
        i++
      ) {
        colEnd = i;
      }
      const colSpan = colEnd - colStart + 1;

      let row = 0;
      for (row = 0; row < rowEnds.length && !(rowEnds[row] < colStart); row++) {
        // find first available row
      }
      rowEnds[row] = colStart + colSpan - 1;
      items.push({ colSpan, colStart, event: ev, row });
    }

    return items;
  }, [allDayEvents, visibleDays]);

  const [isAllDayExpanded, setIsAllDayExpanded] = useState(true);
  const toggleAllDayExpanded = useCallback(
    () => setIsAllDayExpanded((v) => !v),
    []
  );

  const allDayCountPerDay = useMemo<number[]>(
    () =>
      visibleDays.map(
        (d) =>
          allDayEvents.filter((ev) => {
            const evStart = new CalendarDate(
              ev.start.year,
              ev.start.month,
              ev.start.day
            );
            const evEnd = new CalendarDate(
              ev.end.year,
              ev.end.month,
              ev.end.day
            );
            return evStart.compare(d) <= 0 && evEnd.compare(d) >= 0;
          }).length
      ),
    [allDayEvents, visibleDays]
  );

  const heading = useMemo<string>(() => {
    if (!headingFormatterRef.current) {
      headingFormatterRef.current = new DateFormatter(locale, {
        month: 'long',
        year: 'numeric',
      });
    }
    return headingFormatterRef.current.format(date.toDate(timeZone));
  }, [date, locale, timeZone]);

  const goToNext = useCallback(() => {
    setDate(
      date.add(
        view === 'day'
          ? { days: 1 }
          : view === 'week'
            ? { days: weekDays }
            : { months: 1 }
      )
    );
  }, [view, date, setDate, weekDays]);

  const goToPrevious = useCallback(() => {
    setDate(
      date.subtract(
        view === 'day'
          ? { days: 1 }
          : view === 'week'
            ? { days: weekDays }
            : { months: 1 }
      )
    );
  }, [view, date, setDate, weekDays]);

  const goToToday = useCallback(
    () => setDate(today(timeZone)),
    [setDate, timeZone]
  );

  const selectEvent = useCallback(
    (id: string | null) => selectEventRaw(id),
    [selectEventRaw]
  );

  return {
    allDayCountPerDay,
    allDayEvents,
    allDayLayout,
    date,
    dragState,
    dropPreview,
    endHour,
    events,
    getAllEventsForDay,
    getEventLayout,
    getEventsForDay,
    getMonthRowLayout,
    getPerCellEvents,
    goToNext,
    goToPrevious,
    goToToday,
    heading,
    isAllDayExpanded,
    locale,
    onEventCreate,
    onEventDelete,
    onEventMove,
    onEventResize,
    selectEvent,
    selectedEventId,
    setDate,
    setDragState,
    setDropPreview,
    setView,
    slotDuration,
    slots,
    startHour,
    timeZone,
    toggleAllDayExpanded,
    view,
    visibleDays,
    visibleWeeks,
  };
}
