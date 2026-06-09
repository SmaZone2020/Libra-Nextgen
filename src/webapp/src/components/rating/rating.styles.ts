import { tv, type VariantProps } from 'tailwind-variants';

const ratingVariants = tv({
  defaultVariants: {
    size: 'md',
  },
  slots: {
    base: 'rating',
    icon: 'rating__icon',
    iconPartial: 'rating__icon-partial',
    item: 'rating__item',
  },
  variants: {
    size: {
      lg: {
        base: 'rating--lg',
        item: 'rating__item--lg',
      },
      md: {
        base: 'rating--md',
        item: 'rating__item--md',
      },
      sm: {
        base: 'rating--sm',
        item: 'rating__item--sm',
      },
    },
  },
});

export type RatingVariants = VariantProps<typeof ratingVariants>;
export { ratingVariants };
