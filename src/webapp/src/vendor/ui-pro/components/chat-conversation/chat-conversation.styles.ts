import { tv, type VariantProps } from 'tailwind-variants';

const chatConversationVariants = tv({
  slots: {
    base: 'chat-conversation',
    content: 'chat-conversation__content',
    scrollAnchor: 'chat-conversation__scroll-anchor',
    scrollButton: 'chat-conversation__scroll-button',
    scrollButtonContainer: 'chat-conversation__scroll-button-container',
  },
});

export { chatConversationVariants };
export type ChatConversationVariants = VariantProps<
  typeof chatConversationVariants
>;
