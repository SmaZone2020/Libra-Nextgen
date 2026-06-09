import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const kpiVariants = tv({
  slots: {
    actions: 'kpi__actions',
    base: 'kpi',
    chart: 'kpi__chart',
    content: 'kpi__content',
    footer: 'kpi__footer',
    header: 'kpi__header',
    icon: 'kpi__icon',
    progress: 'kpi__progress',
    separator: 'kpi__separator',
    title: 'kpi__title',
    trend: 'kpi__trend',
    value: 'kpi__value',
  },
});

export type KPIVariants = VariantProps<typeof kpiVariants>;
