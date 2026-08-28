import type { ComponentProps } from 'react';
import {
  ChatConversationContent,
  ChatConversationRoot,
  ChatConversationScrollAnchor,
  ChatConversationScrollButton,
} from './chat-conversation';

export type {
  ChatConversationContentProps,
  ChatConversationRootProps as ChatConversationProps,
  ChatConversationRootProps,
  ChatConversationScrollAnchorProps,
  ChatConversationScrollButtonProps,
} from './chat-conversation';
export type { ChatConversationVariants } from './chat-conversation.styles';
export { chatConversationVariants } from './chat-conversation.styles';

const ChatConversation = Object.assign(ChatConversationRoot, {
  Content: ChatConversationContent,
  Root: ChatConversationRoot,
  ScrollAnchor: ChatConversationScrollAnchor,
  ScrollButton: ChatConversationScrollButton,
});

export {
  ChatConversation,
  ChatConversationContent,
  ChatConversationRoot,
  ChatConversationScrollAnchor,
  ChatConversationScrollButton,
};

export type ChatConversation = {
  ContentProps: ComponentProps<typeof ChatConversationContent>;
  Props: ComponentProps<typeof ChatConversationRoot>;
  RootProps: ComponentProps<typeof ChatConversationRoot>;
  ScrollAnchorProps: ComponentProps<typeof ChatConversationScrollAnchor>;
  ScrollButtonProps: ComponentProps<typeof ChatConversationScrollButton>;
};
