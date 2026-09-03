import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const fileTreeVariants = tv({
  defaultVariants: {
    size: 'md',
  },
  slots: {
    base: 'file-tree',
    chevron: 'file-tree__chevron',
    icon: 'file-tree__icon',
    indicator: 'file-tree__indicator',
    item: 'file-tree__item',
    itemContent: 'file-tree__item-content',
    label: 'file-tree__label',
  },
  variants: {
    size: {
      sm: {
        base: 'file-tree--sm',
        item: 'file-tree__item--sm',
      },
      md: {
        base: 'file-tree--md',
        item: 'file-tree__item--md',
      },
      lg: {
        base: 'file-tree--lg',
        item: 'file-tree__item--lg',
      },
    },
  },
});

export type FileTreeVariants = VariantProps<typeof fileTreeVariants>;
