import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const contextMenuVariants = tv({
  slots: {
    menu: 'context-menu__menu',
    popover: 'context-menu__popover',
    separator: 'context-menu__separator',
    trigger: 'context-menu__trigger',
  },
});

export type ContextMenuVariants = VariantProps<typeof contextMenuVariants>;
