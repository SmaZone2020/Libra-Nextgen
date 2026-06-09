import {
  ChatListViewIcon,
  ChatListViewItem,
  ChatListViewItemContent,
  ChatListViewMeta,
  ChatListViewPreview,
  ChatListViewRoot,
  ChatListViewText,
  ChatListViewTitle,
} from './chat-list-view';

export type {
  ChatListViewIconProps,
  ChatListViewItemContentProps,
  ChatListViewItemProps,
  ChatListViewMetaProps,
  ChatListViewPreviewProps,
  ChatListViewRootProps as ChatListViewProps,
  ChatListViewRootProps,
  ChatListViewTextProps,
  ChatListViewTitleProps,
} from './chat-list-view';
export type { ChatListViewVariants } from './chat-list-view.styles';
export { chatListViewVariants } from './chat-list-view.styles';

const ChatListView = Object.assign(ChatListViewRoot, {
  Icon: ChatListViewIcon,
  Item: ChatListViewItem,
  ItemContent: ChatListViewItemContent,
  Meta: ChatListViewMeta,
  Preview: ChatListViewPreview,
  Root: ChatListViewRoot,
  Text: ChatListViewText,
  Title: ChatListViewTitle,
});

export {
  ChatListView,
  ChatListViewIcon,
  ChatListViewItem,
  ChatListViewItemContent,
  ChatListViewMeta,
  ChatListViewPreview,
  ChatListViewRoot,
  ChatListViewText,
  ChatListViewTitle,
};
