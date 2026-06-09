import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const itemCardVariants = tv({
  defaultVariants: {
    variant: 'default',
  },
  slots: {
    action: 'item-card__action',
    base: 'item-card',
    content: 'item-card__content',
    description: 'item-card__description',
    icon: 'item-card__icon',
    title: 'item-card__title',
  },
  variants: {
    variant: {
      default: { base: 'item-card--default' },
      outline: { base: 'item-card--outline' },
      secondary: { base: 'item-card--secondary' },
      tertiary: { base: 'item-card--tertiary' },
      transparent: { base: 'item-card--transparent' },
    },
  },
});

export type ItemCardVariants = VariantProps<typeof itemCardVariants>;
