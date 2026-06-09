import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const itemCardGroupVariants = tv({
  defaultVariants: {
    layout: 'list',
    variant: 'default',
  },
  slots: {
    base: 'item-card-group',
    description: 'item-card-group__description',
    header: 'item-card-group__header',
    title: 'item-card-group__title',
  },
  variants: {
    layout: {
      grid: { base: 'item-card-group--grid' },
      list: { base: 'item-card-group--list' },
    },
    variant: {
      default: { base: 'item-card-group--default' },
      outline: { base: 'item-card-group--outline' },
      secondary: { base: 'item-card-group--secondary' },
      tertiary: { base: 'item-card-group--tertiary' },
      transparent: { base: 'item-card-group--transparent' },
    },
  },
});

export type ItemCardGroupVariants = VariantProps<typeof itemCardGroupVariants>;
