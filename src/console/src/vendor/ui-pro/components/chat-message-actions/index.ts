import type { ComponentProps } from 'react';
import {
  ChatMessageActionsCopiedIcon,
  ChatMessageActionsCopy,
  ChatMessageActionsCopyIcon,
  ChatMessageActionsEdit,
  ChatMessageActionsEditIcon,
  ChatMessageActionsMenu,
  ChatMessageActionsMenuIcon,
  ChatMessageActionsRegenerate,
  ChatMessageActionsRegenerateIcon,
  ChatMessageActionsRoot,
  ChatMessageActionsThumbsDown,
  ChatMessageActionsThumbsDownIcon,
  ChatMessageActionsThumbsUp,
  ChatMessageActionsThumbsUpIcon,
} from './chat-message-actions';

export type {
  ChatMessageActionIconProps,
  ChatMessageActionPresetProps,
  ChatMessageActionIconProps as ChatMessageActionsCopiedIconProps,
  ChatMessageActionsCopyProps,
  ChatMessageActionPresetProps as ChatMessageActionsEditProps,
  ChatMessageActionPresetProps as ChatMessageActionsMenuProps,
  ChatMessageActionsRootProps as ChatMessageActionsProps,
  ChatMessageActionPresetProps as ChatMessageActionsRegenerateProps,
  ChatMessageActionsRootProps,
  ChatMessageActionPresetProps as ChatMessageActionsThumbsDownProps,
  ChatMessageActionPresetProps as ChatMessageActionsThumbsUpProps,
} from './chat-message-actions';
export type { ChatMessageActionsVariants } from './chat-message-actions.styles';
export { chatMessageActionsVariants } from './chat-message-actions.styles';

const ChatMessageActions = Object.assign(ChatMessageActionsRoot, {
  CopiedIcon: ChatMessageActionsCopiedIcon,
  Copy: ChatMessageActionsCopy,
  CopyIcon: ChatMessageActionsCopyIcon,
  Edit: ChatMessageActionsEdit,
  EditIcon: ChatMessageActionsEditIcon,
  Menu: ChatMessageActionsMenu,
  MenuIcon: ChatMessageActionsMenuIcon,
  Regenerate: ChatMessageActionsRegenerate,
  RegenerateIcon: ChatMessageActionsRegenerateIcon,
  Root: ChatMessageActionsRoot,
  ThumbsDown: ChatMessageActionsThumbsDown,
  ThumbsDownIcon: ChatMessageActionsThumbsDownIcon,
  ThumbsUp: ChatMessageActionsThumbsUp,
  ThumbsUpIcon: ChatMessageActionsThumbsUpIcon,
});

export {
  ChatMessageActions,
  ChatMessageActionsCopiedIcon,
  ChatMessageActionsCopy,
  ChatMessageActionsCopyIcon,
  ChatMessageActionsEdit,
  ChatMessageActionsEditIcon,
  ChatMessageActionsMenu,
  ChatMessageActionsMenuIcon,
  ChatMessageActionsRegenerate,
  ChatMessageActionsRegenerateIcon,
  ChatMessageActionsRoot,
  ChatMessageActionsThumbsDown,
  ChatMessageActionsThumbsDownIcon,
  ChatMessageActionsThumbsUp,
  ChatMessageActionsThumbsUpIcon,
};

export type ChatMessageActions = {
  CopyIconProps: ComponentProps<typeof ChatMessageActionsCopyIcon>;
  CopyProps: ComponentProps<typeof ChatMessageActionsCopy>;
  CopiedIconProps: ComponentProps<typeof ChatMessageActionsCopiedIcon>;
  EditIconProps: ComponentProps<typeof ChatMessageActionsEditIcon>;
  EditProps: ComponentProps<typeof ChatMessageActionsEdit>;
  MenuIconProps: ComponentProps<typeof ChatMessageActionsMenuIcon>;
  MenuProps: ComponentProps<typeof ChatMessageActionsMenu>;
  Props: ComponentProps<typeof ChatMessageActionsRoot>;
  RegenerateIconProps: ComponentProps<typeof ChatMessageActionsRegenerateIcon>;
  RegenerateProps: ComponentProps<typeof ChatMessageActionsRegenerate>;
  RootProps: ComponentProps<typeof ChatMessageActionsRoot>;
  ThumbsDownIconProps: ComponentProps<typeof ChatMessageActionsThumbsDownIcon>;
  ThumbsDownProps: ComponentProps<typeof ChatMessageActionsThumbsDown>;
  ThumbsUpIconProps: ComponentProps<typeof ChatMessageActionsThumbsUpIcon>;
  ThumbsUpProps: ComponentProps<typeof ChatMessageActionsThumbsUp>;
};
