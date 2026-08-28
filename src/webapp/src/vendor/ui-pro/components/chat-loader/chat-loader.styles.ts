import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

const chatLoaderVariants = tv({
  defaultVariants: {
    size: 'md',
  },
  slots: {
    base: 'chat-loader',
    dot: 'chat-loader__dot',
    dots: 'chat-loader__dots',
    pulse: 'chat-loader__pulse',
    skeleton: 'chat-loader__skeleton',
    skeletonAvatar: 'chat-loader__skeleton-avatar',
    skeletonBlock: 'chat-loader__skeleton-block',
    skeletonLine: 'chat-loader__skeleton-line',
    spinner: 'chat-loader__spinner',
  },
  variants: {
    size: {
      lg: {
        dot: 'chat-loader__dot--lg',
        dots: 'chat-loader__dots--lg',
        pulse: 'chat-loader__pulse--lg',
        skeletonAvatar: 'chat-loader__skeleton-avatar--lg',
        skeletonLine: 'chat-loader__skeleton-line--lg',
      },
      md: {},
      sm: {
        dot: 'chat-loader__dot--sm',
        dots: 'chat-loader__dots--sm',
        pulse: 'chat-loader__pulse--sm',
        skeletonAvatar: 'chat-loader__skeleton-avatar--sm',
        skeletonLine: 'chat-loader__skeleton-line--sm',
      },
    },
  },
});

export { chatLoaderVariants };
export type ChatLoaderVariants = VariantProps<typeof chatLoaderVariants>;
