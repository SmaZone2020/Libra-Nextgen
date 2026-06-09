import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const agendaVariants = tv({
  defaultVariants: { view: 'week' },
  slots: {
    allDaySection: 'agenda__all-day-section',
    base: 'agenda',
    body: 'agenda__body',
    currentTimeIndicator: 'agenda__current-time-indicator',
    currentTimeLine: 'agenda__current-time-line',
    dayColumn: 'agenda__day-column',
    dayHeader: 'agenda__day-header',
    dayHeaderDate: 'agenda__day-header-date',
    dayHeaderName: 'agenda__day-header-name',
    event: 'agenda__event',
    eventTime: 'agenda__event-time',
    eventTitle: 'agenda__event-title',
    header: 'agenda__header',
    heading: 'agenda__heading',
    monthCell: 'agenda__month-cell',
    monthCellDate: 'agenda__month-cell-date',
    monthEvent: 'agenda__month-event',
    monthGrid: 'agenda__month-grid',
    monthRow: 'agenda__month-row',
    navButton: 'agenda__nav-button',
    navigation: 'agenda__navigation',
    timeGrid: 'agenda__time-grid',
    timeLabel: 'agenda__time-label',
    timeLabels: 'agenda__time-labels',
    timeSlot: 'agenda__time-slot',
    todayButton: 'agenda__today-button',
    viewSelector: 'agenda__view-selector',
    weekHeader: 'agenda__week-header',
  },
  variants: {
    view: {
      day: {
        base: 'agenda--day',
        timeGrid: 'agenda__time-grid--day',
      },
      month: {
        base: 'agenda--month',
        body: 'agenda__body--month',
      },
      week: {
        base: 'agenda--week',
        timeGrid: 'agenda__time-grid--week',
      },
    },
  },
});

export type AgendaVariants = VariantProps<typeof agendaVariants>;
