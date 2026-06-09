import { tv, type VariantProps } from 'tailwind-variants';

const segmentVariants = tv({
  defaultVariants: {
    size: 'md',
    variant: 'default',
  },
  slots: {
    base: 'segment',
    indicator: 'segment__indicator',
    item: 'segment__item',
    separator: 'segment__separator',
  },
  variants: {
    size: {
      lg: {
        base: 'segment--lg',
        item: 'segment__item--lg',
      },
      md: {
        base: 'segment--md',
        item: 'segment__item--md',
      },
      sm: {
        base: 'segment--sm',
        item: 'segment__item--sm',
      },
    },
    variant: {
      default: {},
      ghost: {
        base: 'segment--ghost',
        indicator: 'segment__indicator--ghost',
        item: 'segment__item--ghost',
      },
    },
  },
});

export type SegmentVariants = VariantProps<typeof segmentVariants>;
export { segmentVariants };
