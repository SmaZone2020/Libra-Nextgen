import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const listViewVariants = tv({
  defaultVariants: {
    variant: 'primary',
  },
  slots: {
    base: 'list-view',
    description: 'list-view__description',
    emptyState: 'list-view__empty-state',
    item: 'list-view__item',
    itemAction: 'list-view__item-action',
    itemContent: 'list-view__item-content',
    loadMore: 'list-view__load-more',
    selectionCell: 'list-view__selection-cell',
    title: 'list-view__title',
  },
  variants: {
    variant: {
      primary: { base: 'list-view--primary' },
      secondary: { base: 'list-view--secondary' },
    },
  },
});

export type ListViewVariants = VariantProps<typeof listViewVariants>;
