import {
  ChatAttachmentName,
  ChatAttachmentPreview,
  ChatAttachmentRemove,
  ChatAttachmentRoot,
} from './chat-attachment';
export { inferChatAttachmentMediaType } from './chat-attachment';
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
  Name: ChatAttachmentName,
  Preview: ChatAttachmentPreview,
  Remove: ChatAttachmentRemove,
  Root: ChatAttachmentRoot,
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
  ChatAttachmentInput,
  ChatAttachmentInputDropzone,
  ChatAttachmentInputRoot,
  ChatAttachmentInputTrigger,
  ChatAttachmentName,
  ChatAttachmentPreview,
  ChatAttachmentRemove,
  ChatAttachmentRoot,
};

export type {
  ChatAttachmentNameProps,
  ChatAttachmentPreviewProps,
  ChatAttachmentRootProps as ChatAttachmentProps,
  ChatAttachmentRemoveProps,
  ChatAttachmentRootProps,
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
