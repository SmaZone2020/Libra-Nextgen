'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Avatar, Button, Tooltip } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { chatMessageVariants } from './chat-message.styles';

export interface ChatMessageUserProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatMessageAssistantProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatMessageBubbleProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatMessageContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatMessageMediaProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatMessageActionsProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatMessageActionProps extends ComponentPropsWithRef<
  typeof Button
> {
  'aria-label'?: string;
  children?: ReactNode;
  tooltip?: ReactNode;
}

export interface ChatMessageBodyProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatMessageAvatarProps extends ComponentPropsWithRef<'div'> {
  alt: string;
  fallback?: string;
  show?: boolean;
  src?: string;
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface ChatMessageContextValue {
  slots?: ReturnType<typeof chatMessageVariants>;
}

const ChatMessageContext = createContext<ChatMessageContextValue>({});

const useSlots = (): ReturnType<typeof chatMessageVariants> => {
  const { slots } = useContext(ChatMessageContext);
  const computed = useMemo(() => chatMessageVariants(), []);
  return slots ?? computed;
};

// ─── ChatMessageUser ──────────────────────────────────────────────────────────

const ChatMessageUser = ({
  children,
  className,
  ...props
}: ChatMessageUserProps) => {
  const slots = useMemo(() => chatMessageVariants(), []);

  return (
    <ChatMessageContext value={{ slots }}>
      <div
        className={composeSlotClassName(slots?.user, className)}
        data-slot="chat-message-user"
        {...props}
      >
        {children}
      </div>
    </ChatMessageContext>
  );
};

// ─── ChatMessageAssistant ─────────────────────────────────────────────────────

const ChatMessageAssistant = ({
  children,
  className,
  ...props
}: ChatMessageAssistantProps) => {
  const slots = useMemo(() => chatMessageVariants(), []);

  return (
    <ChatMessageContext value={{ slots }}>
      <div
        className={composeSlotClassName(slots?.assistant, className)}
        data-slot="chat-message-assistant"
        {...props}
      >
        {children}
      </div>
    </ChatMessageContext>
  );
};

// ─── ChatMessageBubble ────────────────────────────────────────────────────────

const ChatMessageBubble = ({
  children,
  className,
  ...props
}: ChatMessageBubbleProps) => {
  const slots = useSlots();

  return (
    <div
      className={composeSlotClassName(slots?.bubble, className)}
      data-slot="chat-message-bubble"
      {...props}
    >
      {children}
    </div>
  );
};

// ─── ChatMessageContent ───────────────────────────────────────────────────────

const ChatMessageContent = ({
  children,
  className,
  ...props
}: ChatMessageContentProps) => {
  const slots = useSlots();

  return (
    <div
      className={composeSlotClassName(slots?.content, className)}
      data-slot="chat-message-content"
      {...props}
    >
      {children}
    </div>
  );
};

// ─── ChatMessageMedia ─────────────────────────────────────────────────────────

const ChatMessageMedia = ({
  children,
  className,
  ...props
}: ChatMessageMediaProps) => {
  const slots = useSlots();

  return (
    <div
      className={composeSlotClassName(slots?.media, className)}
      data-slot="chat-message-media"
      {...props}
    >
      {children}
    </div>
  );
};

// ─── ChatMessageActions ───────────────────────────────────────────────────────

const ChatMessageActions = ({
  children,
  className,
  ...props
}: ChatMessageActionsProps) => {
  const slots = useSlots();

  return (
    <div
      className={composeSlotClassName(slots?.actions, className)}
      data-slot="chat-message-actions"
      {...props}
    >
      {children}
    </div>
  );
};

// ─── ChatMessageAction ────────────────────────────────────────────────────────

const ChatMessageAction = ({
  'aria-label': ariaLabel,
  children,
  className,
  tooltip,
  ...props
}: ChatMessageActionProps) => {
  const slots = useSlots();

  const button = (
    <Button
      aria-label={ariaLabel}
      className={composeTwRenderProps(className, slots?.action())}
      data-slot="chat-message-action"
      isIconOnly
      size="sm"
      variant="ghost"
      {...props}
    >
      {children}
    </Button>
  );

  return tooltip ? (
    <Tooltip delay={0}>
      <Tooltip.Trigger>{button}</Tooltip.Trigger>
      <Tooltip.Content>{tooltip}</Tooltip.Content>
    </Tooltip>
  ) : (
    button
  );
};

// ─── ChatMessageBody ──────────────────────────────────────────────────────────

const ChatMessageBody = ({
  children,
  className,
  ...props
}: ChatMessageBodyProps) => {
  const slots = useSlots();

  return (
    <div
      className={composeSlotClassName(slots?.body, className)}
      data-slot="chat-message-body"
      {...props}
    >
      {children}
    </div>
  );
};

// ─── ChatMessageAvatar ────────────────────────────────────────────────────────

const ChatMessageAvatar = ({
  alt,
  className,
  fallback,
  show = true,
  src,
  ...props
}: ChatMessageAvatarProps) => {
  const slots = useSlots();

  if (show) {
    return (
      <div
        className={composeSlotClassName(slots?.avatar, className)}
        data-slot="chat-message-avatar"
        {...props}
      >
        <Avatar className="size-8">
          {src ? <Avatar.Image alt={alt} src={src} /> : null}
          {fallback ? <Avatar.Fallback>{fallback}</Avatar.Fallback> : null}
        </Avatar>
      </div>
    );
  }

  return (
    <div
      aria-hidden={true}
      className={composeSlotClassName(slots?.avatarSpacer, className)}
      data-slot="chat-message-avatar-spacer"
      {...props}
    />
  );
};

export {
  ChatMessageAction,
  ChatMessageActions,
  ChatMessageAssistant,
  ChatMessageAvatar,
  ChatMessageBody,
  ChatMessageBubble,
  ChatMessageContent,
  ChatMessageMedia,
  ChatMessageUser,
};
