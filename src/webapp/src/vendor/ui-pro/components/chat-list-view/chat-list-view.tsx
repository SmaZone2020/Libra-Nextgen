'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import {
  ListViewDescription,
  ListViewItem,
  ListViewItemAction,
  ListViewItemContent,
  ListViewRoot,
  ListViewTitle,
} from '../list-view/list-view';
import type { ChatListViewVariants } from './chat-list-view.styles';
import { chatListViewVariants } from './chat-list-view.styles';

export interface ChatListViewRootProps<T extends object> extends Omit<
  ComponentPropsWithRef<typeof ListViewRoot<T>>,
  'variant'
> {
  density?: ChatListViewVariants['density'];
}

export interface ChatListViewItemProps<
  T extends object,
> extends ComponentPropsWithRef<typeof ListViewItem<T>> {
  children: ReactNode;
}

export interface ChatListViewItemContentProps extends ComponentPropsWithRef<
  typeof ListViewItemContent
> {
  children: ReactNode;
}

export interface ChatListViewIconProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatListViewTextProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatListViewTitleProps extends ComponentPropsWithRef<
  typeof ListViewTitle
> {
  children: ReactNode;
}

export interface ChatListViewPreviewProps extends ComponentPropsWithRef<
  typeof ListViewDescription
> {
  children: ReactNode;
}

export interface ChatListViewMetaProps extends ComponentPropsWithRef<
  typeof ListViewItemAction
> {
  children: ReactNode;
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface ChatListViewContextValue {
  density?: 'comfortable' | 'compact';
  slots?: ReturnType<typeof chatListViewVariants>;
}

const ChatListViewContext = createContext<ChatListViewContextValue>({});

const useSlots = (): ReturnType<typeof chatListViewVariants> => {
  const { density, slots } = useContext(ChatListViewContext);
  const computed = useMemo(
    () => chatListViewVariants({ density: density ?? 'comfortable' }),
    [density]
  );
  return slots ?? computed;
};

// ─── ChatListViewRoot ─────────────────────────────────────────────────────────

const ChatListViewRoot = <T extends object>({
  children,
  className,
  density = 'comfortable',
  ...props
}: ChatListViewRootProps<T>) => {
  const slots = useMemo(() => chatListViewVariants({ density }), [density]);

  return (
    <ChatListViewContext value={{ density, slots }}>
      <ListViewRoot
        className={composeTwRenderProps(className, slots.base())}
        data-slot="chat-list-view"
        variant="secondary"
        {...props}
      >
        {children}
      </ListViewRoot>
    </ChatListViewContext>
  );
};

// ─── ChatListViewItem ─────────────────────────────────────────────────────────

const ChatListViewItem = <T extends object>({
  children,
  className,
  ...props
}: ChatListViewItemProps<T>) => (
  <ListViewItem
    className={className}
    data-slot="chat-list-view-item"
    {...props}
  >
    {children}
  </ListViewItem>
);

// ─── ChatListViewItemContent ──────────────────────────────────────────────────

const ChatListViewItemContent = ({
  children,
  className,
  ...props
}: ChatListViewItemContentProps) => (
  <ListViewItemContent
    className={className}
    data-slot="chat-list-view-item-content"
    {...props}
  >
    {children}
  </ListViewItemContent>
);

// ─── ChatListViewIcon ─────────────────────────────────────────────────────────

const ChatListViewIcon = ({
  children,
  className,
  ...props
}: ChatListViewIconProps) => {
  const slots = useSlots();
  return (
    <div
      className={composeSlotClassName(slots?.icon, className)}
      data-slot="chat-list-view-icon"
      {...props}
    >
      {children}
    </div>
  );
};

// ─── ChatListViewText ─────────────────────────────────────────────────────────

const ChatListViewText = ({
  children,
  className,
  ...props
}: ChatListViewTextProps) => {
  const slots = useSlots();
  return (
    <div
      className={composeSlotClassName(slots?.text, className)}
      data-slot="chat-list-view-text"
      {...props}
    >
      {children}
    </div>
  );
};

// ─── ChatListViewTitle ────────────────────────────────────────────────────────

const ChatListViewTitle = ({
  children,
  className,
  ...props
}: ChatListViewTitleProps) => {
  const slots = useSlots();
  return (
    <ListViewTitle
      className={composeSlotClassName(slots?.title, className)}
      data-slot="chat-list-view-title"
      {...props}
    >
      {children}
    </ListViewTitle>
  );
};

// ─── ChatListViewPreview ──────────────────────────────────────────────────────

const ChatListViewPreview = ({
  children,
  className,
  ...props
}: ChatListViewPreviewProps) => {
  const slots = useSlots();
  return (
    <ListViewDescription
      className={composeSlotClassName(slots?.preview, className)}
      data-slot="chat-list-view-preview"
      {...props}
    >
      {children}
    </ListViewDescription>
  );
};

// ─── ChatListViewMeta ─────────────────────────────────────────────────────────

const ChatListViewMeta = ({
  children,
  className,
  ...props
}: ChatListViewMetaProps) => {
  const slots = useSlots();
  return (
    <ListViewItemAction
      className={composeSlotClassName(slots?.meta, className)}
      data-slot="chat-list-view-meta"
      {...props}
    >
      {children}
    </ListViewItemAction>
  );
};

export {
  ChatListViewIcon,
  ChatListViewItem,
  ChatListViewItemContent,
  ChatListViewMeta,
  ChatListViewPreview,
  ChatListViewRoot,
  ChatListViewText,
  ChatListViewTitle,
};
