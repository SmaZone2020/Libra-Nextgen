import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const floatingTocVariants = tv({
  slots: {
    bar: 'floating-toc__bar',
    content: 'floating-toc__content',
    item: 'floating-toc__item',
    trigger: 'floating-toc__trigger',
  },
});

export type FloatingTocVariants = VariantProps<typeof floatingTocVariants>;
