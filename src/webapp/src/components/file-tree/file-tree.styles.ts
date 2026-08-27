import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

/**
 * HeroUI Pro FileTree 样式槽位。
 * 对应 src/styles/components/file-tree.css 中的类名。
 */
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
