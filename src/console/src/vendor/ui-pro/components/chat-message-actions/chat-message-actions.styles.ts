import { tv, type VariantProps } from 'tailwind-variants';

const chatMessageActionsVariants = tv({
  slots: {
    base: 'chat-message-actions',
  },
});

export { chatMessageActionsVariants };
export type ChatMessageActionsVariants = VariantProps<
  typeof chatMessageActionsVariants
>;
