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
