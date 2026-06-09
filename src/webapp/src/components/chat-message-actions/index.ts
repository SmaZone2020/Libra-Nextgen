import {
  ChatMessageActionsCopiedIcon,
  ChatMessageActionsCopy,
  ChatMessageActionsCopyIcon,
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
