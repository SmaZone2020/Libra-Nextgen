import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const fileTreeVariants = tv({
  defaultVariants: { size: 'md' },
  slots: {
    base: 'file-tree',
    checkbox: 'file-tree__checkbox',
    chevron: 'file-tree__chevron',
    dragHandle: 'file-tree__drag-handle',
    guideLine: 'file-tree__guide-line',
    icon: 'file-tree__icon',
    indicator: 'file-tree__indicator',
    item: 'file-tree__item',
    itemContent: 'file-tree__item-content',
    label: 'file-tree__label',
    section: 'file-tree__section',
    sectionHeader: 'file-tree__section-header',
  },
  variants: {
    guideLines: {
      always: {},
      hover: { guideLine: 'file-tree__guide-line--hover' },
      none: { guideLine: 'file-tree__guide-line--none' },
    },
    size: {
      lg: { base: 'file-tree--lg', item: 'file-tree__item--lg' },
      md: { base: 'file-tree--md', item: 'file-tree__item--md' },
      sm: { base: 'file-tree--sm', item: 'file-tree__item--sm' },
    },
  },
});

export type FileTreeVariants = VariantProps<typeof fileTreeVariants>;
