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
