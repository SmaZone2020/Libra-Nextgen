import type { ComponentProps } from 'react';
import {
  PromptInputAction,
  PromptInputAttachments,
  PromptInputContent,
  PromptInputFooter,
  PromptInputRoot,
  PromptInputSend,
  PromptInputShell,
  PromptInputTextArea,
  PromptInputToolbar,
  PromptInputToolbarEnd,
  PromptInputToolbarStart,
} from './prompt-input';
import type {
  PromptInputQueueItem,
  PromptInputQueueItemAction,
  PromptInputQueueItemActions,
  PromptInputQueueItemAttachments,
  PromptInputQueueItemAttachmentsOverflow,
  PromptInputQueueItemBody,
  PromptInputQueueItemContent,
  PromptInputQueueItemDescription,
  PromptInputQueueItemHandle,
  PromptInputQueueItemIcon,
  PromptInputQueueItemMore,
  PromptInputQueueItemRemove,
  PromptInputQueueItemSteer,
  PromptInputQueueList,
} from './prompt-input.queue';
import { PromptInputQueue } from './prompt-input.queue';

export {
  PromptInputQueueItem,
  PromptInputQueueItemAction,
  PromptInputQueueItemActions,
  PromptInputQueueItemAttachments,
  PromptInputQueueItemAttachmentsOverflow,
  PromptInputQueueItemBody,
  PromptInputQueueItemContent,
  PromptInputQueueItemDescription,
  PromptInputQueueItemHandle,
  PromptInputQueueItemIcon,
  PromptInputQueueItemMore,
  PromptInputQueueItemRemove,
  PromptInputQueueItemSteer,
  PromptInputQueueList,
} from './prompt-input.queue';
export { promptInputVariants } from './prompt-input.styles';
export {
  getPromptInputLineHeight,
  getPromptInputSingleLineHeight,
  isPromptInputGenerating,
  isPromptInputTextAreaExpanded,
  PROMPT_INPUT_INLINE_COMPACT_HEIGHT,
  resolvePromptInputStatus,
  resolvePromptInputTextAreaElement,
} from './prompt-input.utils';

const PromptInput = Object.assign(PromptInputRoot, {
  Action: PromptInputAction,
  Attachments: PromptInputAttachments,
  Content: PromptInputContent,
  Footer: PromptInputFooter,
  Queue: PromptInputQueue,
  Root: PromptInputRoot,
  Send: PromptInputSend,
  Shell: PromptInputShell,
  TextArea: PromptInputTextArea,
  Toolbar: PromptInputToolbar,
  ToolbarEnd: PromptInputToolbarEnd,
  ToolbarStart: PromptInputToolbarStart,
});

export {
  PromptInput,
  PromptInputAction,
  PromptInputAttachments,
  PromptInputContent,
  PromptInputFooter,
  PromptInputQueue,
  PromptInputRoot,
  PromptInputSend,
  PromptInputShell,
  PromptInputTextArea,
  PromptInputToolbar,
  PromptInputToolbarEnd,
  PromptInputToolbarStart,
};

export type {
  PromptInputActionProps,
  PromptInputAttachmentsProps,
  PromptInputContentProps,
  PromptInputFooterProps,
  PromptInputProps,
  PromptInputRootProps,
  PromptInputSendProps,
  PromptInputShellProps,
  PromptInputTextAreaProps,
  PromptInputToolbarEndProps,
  PromptInputToolbarProps,
  PromptInputToolbarStartProps,
} from './prompt-input';
export type {
  PromptInputQueueItemActionProps,
  PromptInputQueueItemActionsProps,
  PromptInputQueueItemAttachmentsOverflowProps,
  PromptInputQueueItemAttachmentsProps,
  PromptInputQueueItemBodyProps,
  PromptInputQueueItemContentProps,
  PromptInputQueueItemDescriptionProps,
  PromptInputQueueItemHandleProps,
  PromptInputQueueItemIconProps,
  PromptInputQueueItemMoreProps,
  PromptInputQueueItemProps,
  PromptInputQueueItemRemoveProps,
  PromptInputQueueItemSteerProps,
  PromptInputQueueListProps,
  PromptInputQueueProps,
  QueueActionsVisibility,
} from './prompt-input.queue';
export type { PromptInputVariants } from './prompt-input.styles';
export type { ChatStatus } from './prompt-input.types';

export type PromptInput = {
  ActionProps: ComponentProps<typeof PromptInputAction>;
  AttachmentsProps: ComponentProps<typeof PromptInputAttachments>;
  ContentProps: ComponentProps<typeof PromptInputContent>;
  FooterProps: ComponentProps<typeof PromptInputFooter>;
  Props: ComponentProps<typeof PromptInputRoot>;
  QueueItemActionProps: ComponentProps<typeof PromptInputQueueItemAction>;
  QueueItemActionsProps: ComponentProps<typeof PromptInputQueueItemActions>;
  QueueItemAttachmentsOverflowProps: ComponentProps<
    typeof PromptInputQueueItemAttachmentsOverflow
  >;
  QueueItemAttachmentsProps: ComponentProps<
    typeof PromptInputQueueItemAttachments
  >;
  QueueItemBodyProps: ComponentProps<typeof PromptInputQueueItemBody>;
  QueueItemContentProps: ComponentProps<typeof PromptInputQueueItemContent>;
  QueueItemDescriptionProps: ComponentProps<
    typeof PromptInputQueueItemDescription
  >;
  QueueItemHandleProps: ComponentProps<typeof PromptInputQueueItemHandle>;
  QueueItemIconProps: ComponentProps<typeof PromptInputQueueItemIcon>;
  QueueItemMoreProps: ComponentProps<typeof PromptInputQueueItemMore>;
  QueueItemProps: ComponentProps<typeof PromptInputQueueItem>;
  QueueItemRemoveProps: ComponentProps<typeof PromptInputQueueItemRemove>;
  QueueItemSteerProps: ComponentProps<typeof PromptInputQueueItemSteer>;
  QueueListProps: ComponentProps<typeof PromptInputQueueList>;
  QueueProps: ComponentProps<typeof PromptInputQueue>;
  RootProps: ComponentProps<typeof PromptInputRoot>;
  SendProps: ComponentProps<typeof PromptInputSend>;
  ShellProps: ComponentProps<typeof PromptInputShell>;
  TextAreaProps: ComponentProps<typeof PromptInputTextArea>;
  ToolbarEndProps: ComponentProps<typeof PromptInputToolbarEnd>;
  ToolbarProps: ComponentProps<typeof PromptInputToolbar>;
  ToolbarStartProps: ComponentProps<typeof PromptInputToolbarStart>;
};
