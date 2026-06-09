'use client';

import type { ComponentPropsWithRef } from 'react';
import React, { createContext, useContext, useMemo } from 'react';
import { cx } from 'tailwind-variants';
import { CloseButton } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { FileText } from '../icons';
import { chatAttachmentVariants } from './chat-attachment.styles';

export type ChatAttachmentMediaType =
  | 'audio'
  | 'document'
  | 'image'
  | 'unknown'
  | 'video';

export function inferChatAttachmentMediaType(
  mimeType?: string
): ChatAttachmentMediaType {
  if (!mimeType) return 'unknown';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/') || mimeType.startsWith('application/'))
    return 'document';
  return 'unknown';
}

interface ChatAttachmentContextValue {
  mediaType: ChatAttachmentMediaType;
  mimeType?: string;
  name?: string;
  slots: ReturnType<typeof chatAttachmentVariants>;
  src?: string;
}

const ChatAttachmentContext = createContext<ChatAttachmentContextValue>({
  mediaType: 'unknown',
  slots: chatAttachmentVariants(),
});

const useChatAttachmentContext = () => useContext(ChatAttachmentContext);
const useSlots = () => {
  const { slots } = useChatAttachmentContext();
  const fallback = useMemo(() => chatAttachmentVariants(), []);
  return slots ?? fallback;
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ChatAttachmentRootProps extends ComponentPropsWithRef<'div'> {
  children?: React.ReactNode;
  mediaType?: ChatAttachmentMediaType;
  mimeType?: string;
  name?: string;
  src?: string;
}

export type ChatAttachmentPreviewProps = {
  children?: React.ReactNode;
  className?: string;
};

export interface ChatAttachmentNameProps extends ComponentPropsWithRef<'span'> {
  children?: React.ReactNode;
}

export type ChatAttachmentRemoveProps = ComponentPropsWithRef<
  typeof CloseButton
>;

// ─── Components ───────────────────────────────────────────────────────────────

export const ChatAttachmentRoot = ({
  children,
  className,
  mediaType,
  mimeType,
  name,
  src,
  ...props
}: ChatAttachmentRootProps) => {
  const slots = useMemo(() => chatAttachmentVariants(), []);
  const resolvedMediaType = mediaType ?? inferChatAttachmentMediaType(mimeType);

  return (
    <ChatAttachmentContext.Provider
      value={{ mediaType: resolvedMediaType, mimeType, name, slots, src }}
    >
      <div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="chat-attachment"
        {...props}
      >
        {children ?? <ChatAttachmentPreview />}
      </div>
    </ChatAttachmentContext.Provider>
  );
};

export const ChatAttachmentPreview = ({
  children,
  className,
}: ChatAttachmentPreviewProps) => {
  const { mediaType, name, src } = useChatAttachmentContext();
  const slots = useSlots();

  if (children && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<{ className?: string }>,
      {
        className: cx(
          composeSlotClassName(slots?.preview, className),
          (children as React.ReactElement<{ className?: string }>).props
            .className
        ),
        'data-slot': 'chat-attachment-preview',
      } as React.HTMLAttributes<HTMLElement>
    );
  }

  return (
    <div
      className={composeSlotClassName(slots?.preview, className)}
      data-slot="chat-attachment-preview"
    >
      {mediaType === 'image' && src ? (
        <img
          alt={name ?? 'Attachment'}
          className={composeSlotClassName(slots?.previewImage, undefined)}
          data-slot="chat-attachment-preview-image"
          src={src}
        />
      ) : mediaType === 'video' && src ? (
        <video
          className={composeSlotClassName(slots?.previewVideo, undefined)}
          data-slot="chat-attachment-preview-video"
          muted
          src={src}
        />
      ) : (
        <span
          className={composeSlotClassName(slots?.previewFallback, undefined)}
        >
          <FileText className="size-3.5" />
        </span>
      )}
    </div>
  );
};

export const ChatAttachmentName = ({
  children,
  className,
  ...props
}: ChatAttachmentNameProps) => {
  const { name } = useChatAttachmentContext();
  const slots = useSlots();
  return (
    <span
      className={composeSlotClassName(slots?.name, className)}
      data-slot="chat-attachment-name"
      {...props}
    >
      {children ?? name}
    </span>
  );
};

export const ChatAttachmentRemove = ({
  children,
  className,
  ...props
}: ChatAttachmentRemoveProps) => {
  const slots = useSlots();
  return (
    <CloseButton
      className={composeTwRenderProps(className, slots?.remove())}
      data-slot="chat-attachment-remove"
      {...props}
    >
      {children}
    </CloseButton>
  );
};
