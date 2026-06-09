'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  useReducedMotion,
} from 'motion/react';
import * as m from 'motion/react-m';
import { cx } from 'tailwind-variants';
import { composeSlotClassName } from '../../utils/compose';
import { ChatMessage } from '../chat-message/index';
import {
  ArrowsRotateLeft,
  Check,
  Copy,
  Ellipsis,
  ThumbsDown,
  ThumbsUp,
} from '../icons';
import { chatMessageActionsVariants } from './chat-message-actions.styles';

export interface ChatMessageActionsRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export type ChatMessageActionPresetProps = ComponentPropsWithRef<
  typeof ChatMessage.Action
> & {
  children?: ReactNode;
};

export type ChatMessageActionsCopyProps = ChatMessageActionPresetProps & {
  copiedIcon?: ReactNode;
  isCopied?: boolean;
};

export type ChatMessageActionIconProps = {
  children?: ReactNode;
  className?: string;
};

// ─── ChatMessageActionsRoot ───────────────────────────────────────────────────

const ChatMessageActionsRoot = ({
  children,
  className,
  ...props
}: ChatMessageActionsRootProps) => {
  const slots = useMemo(() => chatMessageActionsVariants(), []);

  return (
    <ChatMessage.Actions
      className={composeSlotClassName(slots?.base, className)}
      data-slot="chat-message-actions"
      {...props}
    >
      {children}
    </ChatMessage.Actions>
  );
};

// ─── Icon wrapper factory ─────────────────────────────────────────────────────

function makeIconWrapper(
  DefaultIcon: React.ComponentType<React.SVGProps<SVGSVGElement>>,
  slot: string
) {
  return ({ children, className, ...props }: ChatMessageActionIconProps) => {
    if (children && React.isValidElement(children)) {
      const child = children as React.ReactElement<{
        className?: string;
        'data-slot'?: string;
      }>;
      return React.cloneElement(child, {
        ...props,
        className: cx('size-4', className, child.props.className),
        'data-slot': slot,
      });
    }
    return (
      <DefaultIcon
        className={cx('size-4', className)}
        data-slot={slot}
        {...props}
      />
    );
  };
}

// ─── Preset action factory ────────────────────────────────────────────────────

function makePresetAction(
  DefaultIcon: React.ComponentType<React.SVGProps<SVGSVGElement>>,
  displayName: string
) {
  const Component = ({ children, ...props }: ChatMessageActionPresetProps) => (
    <ChatMessage.Action {...props}>
      {children && React.isValidElement(children) ? children : <DefaultIcon />}
    </ChatMessage.Action>
  );
  Component.displayName = displayName;
  return Component;
}

// ─── Icon components ──────────────────────────────────────────────────────────

const ChatMessageActionsCopyIcon = makeIconWrapper(
  Copy,
  'chat-message-actions-copy-icon'
);
const ChatMessageActionsCopiedIcon = makeIconWrapper(
  Check,
  'chat-message-actions-copied-icon'
);
const ChatMessageActionsRegenerateIcon = makeIconWrapper(
  ArrowsRotateLeft,
  'chat-message-actions-regenerate-icon'
);
const ChatMessageActionsMenuIcon = makeIconWrapper(
  Ellipsis,
  'chat-message-actions-menu-icon'
);
const ChatMessageActionsThumbsUpIcon = makeIconWrapper(
  ThumbsUp,
  'chat-message-actions-thumbs-up-icon'
);
const ChatMessageActionsThumbsDownIcon = makeIconWrapper(
  ThumbsDown,
  'chat-message-actions-thumbs-down-icon'
);

// ─── ChatMessageActionsCopy ───────────────────────────────────────────────────

const ChatMessageActionsCopy = ({
  children,
  copiedIcon,
  isCopied: isCopiedProp,
  onPress,
  ...props
}: ChatMessageActionsCopyProps) => {
  const [isCopiedLocal, setIsCopiedLocal] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReducedMotion = useReducedMotion();

  const isControlled = isCopiedProp !== undefined;
  const isCopied = isCopiedProp ?? isCopiedLocal;

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );

  const copyIcon =
    children && React.isValidElement(children) ? (
      children
    ) : (
      <ChatMessageActionsCopyIcon />
    );

  return (
    <ChatMessage.Action
      {...props}
      onPress={(event) => {
        onPress?.(event);
        if (!isControlled) {
          setIsCopiedLocal(true);
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            setIsCopiedLocal(false);
            timerRef.current = null;
          }, 2000);
        }
      }}
    >
      <LazyMotion features={domAnimation}>
        <AnimatePresence initial={false} mode="popLayout">
          <m.span
            key={isCopied ? 'check' : 'copy'}
            className="flex size-4 items-center justify-center"
            data-slot="chat-message-actions-copy-icon-motion"
            {...(isReducedMotion
              ? {
                  animate: { opacity: 1 },
                  exit: { opacity: 0 },
                  initial: { opacity: 0 },
                  transition: { duration: 0.12 },
                }
              : {
                  animate: { filter: 'blur(0px)', opacity: 1, scale: 1 },
                  exit: { filter: 'blur(4px)', opacity: 0, scale: 0.25 },
                  initial: { filter: 'blur(4px)', opacity: 0, scale: 0.25 },
                  transition: { bounce: 0, duration: 0.3, type: 'spring' },
                })}
          >
            {isCopied ? (
              copiedIcon && React.isValidElement(copiedIcon) ? (
                copiedIcon
              ) : (
                <ChatMessageActionsCopiedIcon />
              )
            ) : (
              copyIcon
            )}
          </m.span>
        </AnimatePresence>
      </LazyMotion>
    </ChatMessage.Action>
  );
};

// ─── Preset actions ───────────────────────────────────────────────────────────

const ChatMessageActionsRegenerate = makePresetAction(
  ArrowsRotateLeft,
  'ChatMessageActionsRegenerate'
);
const ChatMessageActionsMenu = makePresetAction(
  Ellipsis,
  'ChatMessageActionsMenu'
);
const ChatMessageActionsThumbsUp = makePresetAction(
  ThumbsUp,
  'ChatMessageActionsThumbsUp'
);
const ChatMessageActionsThumbsDown = makePresetAction(
  ThumbsDown,
  'ChatMessageActionsThumbsDown'
);

export {
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
