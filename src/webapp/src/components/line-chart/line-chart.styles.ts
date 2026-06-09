import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const lineChartVariants = tv({
  slots: {
    base: 'line-chart',
  },
});

export type LineChartVariants = VariantProps<typeof lineChartVariants>;
