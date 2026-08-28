import type { ComponentProps } from 'react';
import {
  ChatSourceDocumentIcon,
  ChatSourceIcon,
  ChatSourcePreview,
  ChatSourceRoot,
  ChatSourceTitle,
  ChatSourceTrigger,
} from './chat-source';
export { extractSourceDomain } from './chat-source';
import {
  ChatSourcesContent,
  ChatSourcesList,
  ChatSourcesRoot,
  ChatSourcesTrigger,
} from './chat-sources';
export type {
  ChatSourcesVariants,
  ChatSourceVariants,
} from './chat-source.styles';
export { chatSourcesVariants, chatSourceVariants } from './chat-source.styles';

const ChatSource = Object.assign(ChatSourceRoot, {
  DocumentIcon: ChatSourceDocumentIcon,
  Icon: ChatSourceIcon,
  Preview: ChatSourcePreview,
  Root: ChatSourceRoot,
  Title: ChatSourceTitle,
  Trigger: ChatSourceTrigger,
});

const ChatSources = Object.assign(ChatSourcesRoot, {
  Content: ChatSourcesContent,
  List: ChatSourcesList,
  Root: ChatSourcesRoot,
  Trigger: ChatSourcesTrigger,
});

export {
  ChatSource,
  ChatSourceDocumentIcon,
  ChatSourceIcon,
  ChatSourcePreview,
  ChatSourceRoot,
  ChatSources,
  ChatSourcesContent,
  ChatSourcesList,
  ChatSourcesRoot,
  ChatSourcesTrigger,
  ChatSourceTitle,
  ChatSourceTrigger,
};

export type {
  ChatSourceIconProps,
  ChatSourcePreviewProps,
  ChatSourceRootProps as ChatSourceProps,
  ChatSourceRootProps,
  ChatSourceTitleProps,
  ChatSourceTriggerProps,
} from './chat-source';
export type {
  ChatSourcesContentProps,
  ChatSourcesListProps,
  ChatSourcesRootProps as ChatSourcesProps,
  ChatSourcesRootProps,
  ChatSourcesTriggerProps,
} from './chat-sources';

export type ChatSource = {
  DocumentIconProps: ComponentProps<typeof ChatSourceDocumentIcon>;
  IconProps: ComponentProps<typeof ChatSourceIcon>;
  PreviewProps: ComponentProps<typeof ChatSourcePreview>;
  Props: ComponentProps<typeof ChatSourceRoot>;
  RootProps: ComponentProps<typeof ChatSourceRoot>;
  TitleProps: ComponentProps<typeof ChatSourceTitle>;
  TriggerProps: ComponentProps<typeof ChatSourceTrigger>;
};

export type ChatSources = {
  ContentProps: ComponentProps<typeof ChatSourcesContent>;
  ListProps: ComponentProps<typeof ChatSourcesList>;
  Props: ComponentProps<typeof ChatSourcesRoot>;
  RootProps: ComponentProps<typeof ChatSourcesRoot>;
  TriggerProps: ComponentProps<typeof ChatSourcesTrigger>;
};
