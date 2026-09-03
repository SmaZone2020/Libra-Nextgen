import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const emptyStateVariants = tv({
  defaultVariants: { size: 'md' },
  slots: {
    base: 'empty-state',
    content: 'empty-state__content',
    description: 'empty-state__description',
    header: 'empty-state__header',
    media: 'empty-state__media',
    title: 'empty-state__title',
  },
  variants: {
    size: {
      lg: { base: 'empty-state--lg' },
      md: { base: 'empty-state--md' },
      sm: { base: 'empty-state--sm' },
    },
  },
});

export type EmptyStateVariants = VariantProps<typeof emptyStateVariants>;
