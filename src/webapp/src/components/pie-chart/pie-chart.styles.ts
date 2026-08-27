import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const pieChartVariants = tv({
  slots: {
    base: 'pie-chart',
  },
});

export type PieChartVariants = VariantProps<typeof pieChartVariants>;
