import { tv, type VariantProps } from 'tailwind-variants';

const textShimmerVariants = tv({
  slots: {
    base: 'text-shimmer',
  },
});

export type TextShimmerVariants = VariantProps<typeof textShimmerVariants>;
export { textShimmerVariants };
