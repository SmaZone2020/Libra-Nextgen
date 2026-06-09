import { tv, type VariantProps } from 'tailwind-variants';

const radarChartVariants = tv({
  slots: {
    base: 'radar-chart',
  },
});

export type RadarChartVariants = VariantProps<typeof radarChartVariants>;
export { radarChartVariants };
