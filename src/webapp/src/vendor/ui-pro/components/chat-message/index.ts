import type { ComponentProps } from 'react';
import {
  ChatMessageAction,
  ChatMessageActions,
  ChatMessageAssistant,
  ChatMessageAvatar,
  ChatMessageBody,
  ChatMessageBubble,
  ChatMessageContent,
  ChatMessageMedia,
  ChatMessageUser,
} from './chat-message';

export type {
  ChatMessageActionProps,
  ChatMessageAssistantProps,
  ChatMessageAvatarProps,
  ChatMessageBodyProps,
  ChatMessageBubbleProps,
  ChatMessageContentProps,
  ChatMessageMediaProps,
  ChatMessageUserProps,
} from './chat-message';
export type { ChatMessageVariants } from './chat-message.styles';
export { chatMessageVariants } from './chat-message.styles';

const ChatMessage = {
  Action: ChatMessageAction,
  Actions: ChatMessageActions,
  Assistant: ChatMessageAssistant,
  Avatar: ChatMessageAvatar,
  Body: ChatMessageBody,
  Bubble: ChatMessageBubble,
  Content: ChatMessageContent,
  Media: ChatMessageMedia,
  User: ChatMessageUser,
};

export {
  ChatMessage,
  ChatMessageAction,
  ChatMessageAssistant,
  ChatMessageAvatar,
  ChatMessageBody,
  ChatMessageBubble,
  ChatMessageContent,
  ChatMessageMedia,
  ChatMessageUser,
};

export type ChatMessage = {
  ActionProps: ComponentProps<typeof ChatMessageAction>;
  ActionsProps: ComponentProps<typeof ChatMessageActions>;
  AssistantProps: ComponentProps<typeof ChatMessageAssistant>;
  AvatarProps: ComponentProps<typeof ChatMessageAvatar>;
  BodyProps: ComponentProps<typeof ChatMessageBody>;
  BubbleProps: ComponentProps<typeof ChatMessageBubble>;
  ContentProps: ComponentProps<typeof ChatMessageContent>;
  MediaProps: ComponentProps<typeof ChatMessageMedia>;
  UserProps: ComponentProps<typeof ChatMessageUser>;
};
