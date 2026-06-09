import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const barChartVariants = tv({
  slots: {
    base: 'bar-chart',
  },
});

export type BarChartVariants = VariantProps<typeof barChartVariants>;
