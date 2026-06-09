import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const composedChartVariants = tv({
  slots: {
    base: 'composed-chart',
  },
});

export type ComposedChartVariants = VariantProps<typeof composedChartVariants>;
