import { tv, type VariantProps } from 'tailwind-variants';
import type { DOMRenderProps } from '@heroui/react';

const textShimmerVariants = tv({
  slots: {
    base: 'text-shimmer',
  },
});

export type TextShimmerVariants = VariantProps<typeof textShimmerVariants>;
export type TextShimmerRenderProps<
  E extends keyof React.JSX.IntrinsicElements = 'span',
> = DOMRenderProps<E, undefined>;
export { textShimmerVariants };
