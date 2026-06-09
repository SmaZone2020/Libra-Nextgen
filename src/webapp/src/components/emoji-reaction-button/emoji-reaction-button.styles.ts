import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const emojiReactionButtonVariants = tv({
  defaultVariants: { size: 'md' },
  slots: {
    base: 'emoji-reaction-button',
    count: 'emoji-reaction-button__count',
    emoji: 'emoji-reaction-button__emoji',
  },
  variants: {
    size: {
      lg: { base: 'emoji-reaction-button--lg' },
      md: { base: 'emoji-reaction-button--md' },
      sm: { base: 'emoji-reaction-button--sm' },
    },
  },
});

export type EmojiReactionButtonVariants = VariantProps<
  typeof emojiReactionButtonVariants
>;
