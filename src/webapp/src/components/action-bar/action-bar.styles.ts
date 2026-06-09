import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const actionBarVariants = tv({
  slots: {
    base: 'action-bar',
    content: 'action-bar__content',
    label: 'action-bar__label',
    prefix: 'action-bar__prefix',
    suffix: 'action-bar__suffix',
    wrapper: 'action-bar__wrapper',
  },
});

export type ActionBarVariants = VariantProps<typeof actionBarVariants>;
