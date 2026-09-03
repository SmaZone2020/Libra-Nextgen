import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const chartTooltipVariants = tv({
  defaultVariants: { indicator: 'dot' },
  slots: {
    base: 'chart-tooltip',
    header: 'chart-tooltip__header',
    indicator: 'chart-tooltip__indicator',
    item: 'chart-tooltip__item',
    label: 'chart-tooltip__label',
    value: 'chart-tooltip__value',
  },
  variants: {
    indicator: {
      dot: { indicator: 'chart-tooltip__indicator--dot' },
      line: { indicator: 'chart-tooltip__indicator--line' },
    },
  },
});

export type ChartTooltipVariants = VariantProps<typeof chartTooltipVariants>;
