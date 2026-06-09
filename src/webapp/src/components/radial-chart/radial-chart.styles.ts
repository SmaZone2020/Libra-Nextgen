import { tv, type VariantProps } from 'tailwind-variants';

const radialChartVariants = tv({
  slots: {
    base: 'radial-chart',
  },
});

export type RadialChartVariants = VariantProps<typeof radialChartVariants>;
export { radialChartVariants };
