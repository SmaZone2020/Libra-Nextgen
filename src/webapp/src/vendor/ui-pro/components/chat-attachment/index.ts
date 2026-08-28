import type { ComponentProps } from 'react';
import {
  ChatAttachmentIcon,
  ChatAttachmentInfo,
  ChatAttachmentName,
  ChatAttachmentPreview,
  ChatAttachmentRemove,
  ChatAttachmentRoot,
  ChatAttachmentSize,
} from './chat-attachment';
export {
  formatChatAttachmentSize,
  inferChatAttachmentFileKind,
  inferChatAttachmentMediaType,
} from './chat-attachment';
import { ChatAttachmentGroupRoot } from './chat-attachment-group';
import {
  ChatAttachmentInputDropzone,
  ChatAttachmentInputRoot,
  ChatAttachmentInputTrigger,
} from './chat-attachment-input';
export type {
  ChatAttachmentGroupVariants,
  ChatAttachmentVariants,
} from './chat-attachment.styles';
export {
  chatAttachmentGroupVariants,
  chatAttachmentVariants,
} from './chat-attachment.styles';

const ChatAttachment = Object.assign(ChatAttachmentRoot, {
  Icon: ChatAttachmentIcon,
  Info: ChatAttachmentInfo,
  Name: ChatAttachmentName,
  Preview: ChatAttachmentPreview,
  Remove: ChatAttachmentRemove,
  Root: ChatAttachmentRoot,
  Size: ChatAttachmentSize,
});

const ChatAttachmentGroup = Object.assign(ChatAttachmentGroupRoot, {
  Root: ChatAttachmentGroupRoot,
});

const ChatAttachmentInput = Object.assign(ChatAttachmentInputRoot, {
  Dropzone: ChatAttachmentInputDropzone,
  Root: ChatAttachmentInputRoot,
  Trigger: ChatAttachmentInputTrigger,
});

export {
  ChatAttachment,
  ChatAttachmentGroup,
  ChatAttachmentGroupRoot,
  ChatAttachmentIcon,
  ChatAttachmentInfo,
  ChatAttachmentInput,
  ChatAttachmentInputDropzone,
  ChatAttachmentInputRoot,
  ChatAttachmentInputTrigger,
  ChatAttachmentName,
  ChatAttachmentPreview,
  ChatAttachmentRemove,
  ChatAttachmentRoot,
  ChatAttachmentSize,
};

export type {
  ChatAttachmentFileKind,
  ChatAttachmentIconProps,
  ChatAttachmentInfoProps,
  ChatAttachmentMediaType,
  ChatAttachmentNameProps,
  ChatAttachmentPreviewProps,
  ChatAttachmentRootProps as ChatAttachmentProps,
  ChatAttachmentRemoveProps,
  ChatAttachmentRootProps,
  ChatAttachmentSizeProps,
} from './chat-attachment';
export type {
  ChatAttachmentGroupRootProps as ChatAttachmentGroupProps,
  ChatAttachmentGroupRootProps,
} from './chat-attachment-group';
export type {
  ChatAttachmentInputDropzoneProps,
  ChatAttachmentInputProps,
  ChatAttachmentInputTriggerProps,
} from './chat-attachment-input';

export type ChatAttachment = {
  IconProps: ComponentProps<typeof ChatAttachmentIcon>;
  InfoProps: ComponentProps<typeof ChatAttachmentInfo>;
  NameProps: ComponentProps<typeof ChatAttachmentName>;
  PreviewProps: ComponentProps<typeof ChatAttachmentPreview>;
  Props: ComponentProps<typeof ChatAttachmentRoot>;
  RemoveProps: ComponentProps<typeof ChatAttachmentRemove>;
  RootProps: ComponentProps<typeof ChatAttachmentRoot>;
  SizeProps: ComponentProps<typeof ChatAttachmentSize>;
};

export type ChatAttachmentGroup = {
  Props: ComponentProps<typeof ChatAttachmentGroupRoot>;
  RootProps: ComponentProps<typeof ChatAttachmentGroupRoot>;
};

export type ChatAttachmentInput = {
  DropzoneProps: ComponentProps<typeof ChatAttachmentInputDropzone>;
  Props: ComponentProps<typeof ChatAttachmentInputRoot>;
  RootProps: ComponentProps<typeof ChatAttachmentInputRoot>;
  TriggerProps: ComponentProps<typeof ChatAttachmentInputTrigger>;
};
