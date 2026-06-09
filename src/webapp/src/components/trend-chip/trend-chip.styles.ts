import { tv, type VariantProps } from 'tailwind-variants';

const trendChipVariants = tv({
  defaultVariants: {
    size: 'sm',
  },
  slots: {
    base: 'trend-chip',
    indicator: 'trend-chip__indicator',
    prefix: 'trend-chip__prefix',
    suffix: 'trend-chip__suffix',
    value: 'trend-chip__value',
  },
  variants: {
    size: {
      lg: {
        base: 'trend-chip--lg',
      },
      md: {
        base: 'trend-chip--md',
      },
      sm: {
        base: 'trend-chip--sm',
      },
    },
  },
});

export type TrendChipVariants = VariantProps<typeof trendChipVariants>;
export { trendChipVariants };
