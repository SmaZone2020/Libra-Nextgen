'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, Fragment, useContext, useMemo } from 'react';
import { Spinner } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import type { ChatLoaderVariants } from './chat-loader.styles';
import { chatLoaderVariants } from './chat-loader.styles';

export interface ChatLoaderDotsProps extends ComponentPropsWithRef<'span'> {
  label?: string;
  size?: ChatLoaderVariants['size'];
}

export interface ChatLoaderPulseProps extends ComponentPropsWithRef<'span'> {
  label?: string;
  size?: ChatLoaderVariants['size'];
}

export interface ChatLoaderSpinnerProps extends ComponentPropsWithRef<'span'> {
  label?: string;
  size?: ChatLoaderVariants['size'];
}

export interface ChatLoaderSkeletonProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
  label?: string;
  size?: ChatLoaderVariants['size'];
}

export interface ChatLoaderSkeletonAvatarProps extends ComponentPropsWithRef<'div'> {}

export interface ChatLoaderSkeletonBlockProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatLoaderSkeletonLineProps extends ComponentPropsWithRef<'div'> {}

// ─── Context ─────────────────────────────────────────────────────────────────

interface ChatLoaderSkeletonContextValue {
  size: 'sm' | 'md' | 'lg';
  slots?: ReturnType<typeof chatLoaderVariants>;
}

const ChatLoaderSkeletonContext = createContext<ChatLoaderSkeletonContextValue>(
  {
    size: 'md',
  }
);

// ─── ChatLoaderDots ───────────────────────────────────────────────────────────

const ChatLoaderDots = ({
  className,
  label,
  size = 'md',
  ...props
}: ChatLoaderDotsProps) => {
  const slots = useMemo(() => chatLoaderVariants({ size }), [size]);

  return (
    <span
      aria-hidden={!label || undefined}
      aria-label={label}
      className={composeSlotClassName(slots?.dots, className)}
      data-slot="chat-loader-dots"
      role={label ? 'status' : undefined}
      {...props}
    >
      <span className={composeSlotClassName(slots?.dot, undefined)} />
      <span className={composeSlotClassName(slots?.dot, undefined)} />
      <span className={composeSlotClassName(slots?.dot, undefined)} />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
};

// ─── ChatLoaderPulse ──────────────────────────────────────────────────────────

const ChatLoaderPulse = ({
  className,
  label,
  size = 'md',
  ...props
}: ChatLoaderPulseProps) => {
  const slots = useMemo(() => chatLoaderVariants({ size }), [size]);

  return (
    <span
      aria-hidden={!label || undefined}
      aria-label={label}
      className={composeSlotClassName(slots?.pulse, className)}
      data-slot="chat-loader-pulse"
      role={label ? 'status' : undefined}
      {...props}
    >
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
};

// ─── ChatLoaderSpinner ────────────────────────────────────────────────────────

const ChatLoaderSpinner = ({
  className,
  label,
  size = 'md',
  ...props
}: ChatLoaderSpinnerProps) => {
  const slots = useMemo(() => chatLoaderVariants({ size }), [size]);
  const spinnerSize: 'sm' | 'md' | 'lg' =
    size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'md';

  return (
    <span
      aria-hidden={!label || undefined}
      aria-label={label}
      className={composeSlotClassName(slots?.spinner, className)}
      data-slot="chat-loader-spinner"
      role={label ? 'status' : undefined}
      {...props}
    >
      <Spinner size={spinnerSize} />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
};

// ─── ChatLoaderSkeleton ───────────────────────────────────────────────────────

const ChatLoaderSkeleton = ({
  children,
  className,
  label,
  size = 'md',
  ...props
}: ChatLoaderSkeletonProps) => {
  const slots = useMemo(() => chatLoaderVariants({ size }), [size]);

  return (
    <ChatLoaderSkeletonContext value={{ size: size ?? 'md', slots }}>
      <div
        aria-busy="true"
        aria-label={label}
        className={composeSlotClassName(slots?.skeleton, className)}
        data-slot="chat-loader-skeleton"
        role={label ? 'status' : undefined}
        {...props}
      >
        {children ?? (
          <Fragment>
            <ChatLoaderSkeletonAvatar />
            <ChatLoaderSkeletonBlock>
              <ChatLoaderSkeletonLine />
              <ChatLoaderSkeletonLine />
              <ChatLoaderSkeletonLine />
            </ChatLoaderSkeletonBlock>
          </Fragment>
        )}
      </div>
    </ChatLoaderSkeletonContext>
  );
};

// ─── ChatLoaderSkeletonAvatar ─────────────────────────────────────────────────

const ChatLoaderSkeletonAvatar = ({
  className,
  ...props
}: ChatLoaderSkeletonAvatarProps) => {
  const { size, slots: ctxSlots } = useContext(ChatLoaderSkeletonContext);
  const slots = ctxSlots ?? chatLoaderVariants({ size });

  return (
    <div
      className={composeSlotClassName(slots?.skeletonAvatar, className)}
      data-slot="chat-loader-skeleton-avatar"
      {...props}
    />
  );
};

// ─── ChatLoaderSkeletonBlock ──────────────────────────────────────────────────

const ChatLoaderSkeletonBlock = ({
  children,
  className,
  ...props
}: ChatLoaderSkeletonBlockProps) => {
  const { slots: ctxSlots } = useContext(ChatLoaderSkeletonContext);

  return (
    <div
      className={composeSlotClassName(ctxSlots?.skeletonBlock, className)}
      data-slot="chat-loader-skeleton-block"
      {...props}
    >
      {children}
    </div>
  );
};

// ─── ChatLoaderSkeletonLine ───────────────────────────────────────────────────

const ChatLoaderSkeletonLine = ({
  className,
  ...props
}: ChatLoaderSkeletonLineProps) => {
  const { size, slots: ctxSlots } = useContext(ChatLoaderSkeletonContext);
  const slots = ctxSlots ?? chatLoaderVariants({ size });

  return (
    <div
      className={composeSlotClassName(slots?.skeletonLine, className)}
      data-slot="chat-loader-skeleton-line"
      {...props}
    />
  );
};

export {
  ChatLoaderDots,
  ChatLoaderPulse,
  ChatLoaderSkeleton,
  ChatLoaderSkeletonAvatar,
  ChatLoaderSkeletonBlock,
  ChatLoaderSkeletonLine,
  ChatLoaderSpinner,
};
