'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import React, { createContext, useContext, useMemo } from 'react';
import { cx } from 'tailwind-variants';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { HoverCard } from '../hover-card/index';
import { FileText } from '../icons';
import { chatSourceVariants } from './chat-source.styles';

export type ChatSourceType = 'document' | 'url';

export function extractSourceDomain(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href.split('/').pop() || href;
  }
}

function getInitial(text: string): string {
  return text.trim().charAt(0).toUpperCase() || '?';
}

interface ChatSourceContextValue {
  description?: string;
  domain?: string;
  enablePreview: boolean;
  faviconUrl?: string;
  href?: string;
  slots: ReturnType<typeof chatSourceVariants>;
  sourceType: ChatSourceType;
  title?: string;
}

const ChatSourceContext = createContext<ChatSourceContextValue>({
  enablePreview: false,
  slots: chatSourceVariants(),
  sourceType: 'url',
});

const useChatSourceContext = () => useContext(ChatSourceContext);
const useSlots = () => {
  const { slots } = useChatSourceContext();
  const fallback = useMemo(() => chatSourceVariants(), []);
  return slots ?? fallback;
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ChatSourceRootProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
  description?: string;
  /**
   * Controls the hover preview for URL sources. By default, preview is enabled when
   * a URL source has a title or description. Set to `true` for custom preview content.
   */
  enablePreview?: boolean;
  faviconUrl?: string;
  href?: string;
  sourceType?: ChatSourceType;
  title?: string;
}

export interface ChatSourceTriggerProps extends ComponentPropsWithRef<'a'> {
  children?: ReactNode;
  label?: ReactNode;
}

export type ChatSourceIconProps = {
  children?: ReactNode;
  className?: string;
  faviconUrl?: string;
};

export interface ChatSourceTitleProps extends ComponentPropsWithRef<'span'> {
  children?: ReactNode;
}

export interface ChatSourcePreviewProps extends ComponentPropsWithRef<
  typeof HoverCard.Content
> {
  children?: ReactNode;
  description?: ReactNode;
  title?: ReactNode;
}

// ─── Components ───────────────────────────────────────────────────────────────

export const ChatSourceRoot = ({
  children,
  className,
  description,
  enablePreview: enablePreviewProp,
  faviconUrl,
  href,
  sourceType = href ? 'url' : 'document',
  title,
  ...props
}: ChatSourceRootProps) => {
  const slots = useMemo(() => chatSourceVariants(), []);
  const domain = href ? extractSourceDomain(href) : undefined;
  const enablePreview =
    sourceType === 'url' &&
    Boolean(href) &&
    (enablePreviewProp ?? Boolean(description || title));

  const contextValue = useMemo<ChatSourceContextValue>(
    () => ({
      description,
      domain,
      enablePreview,
      faviconUrl,
      href,
      slots,
      sourceType,
      title,
    }),
    [
      description,
      domain,
      enablePreview,
      faviconUrl,
      href,
      slots,
      sourceType,
      title,
    ]
  );

  const body = children ?? (
    <>
      <ChatSourceTrigger />
      {enablePreview ? (
        <ChatSourcePreview description={description} title={title} />
      ) : null}
    </>
  );

  const rootEl = (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="chat-source"
      data-source-type={sourceType}
      {...props}
    >
      {body}
    </div>
  );

  return (
    <ChatSourceContext.Provider value={contextValue}>
      {enablePreview ? (
        <HoverCard closeDelay={0} openDelay={150}>
          {rootEl}
        </HoverCard>
      ) : (
        rootEl
      )}
    </ChatSourceContext.Provider>
  );
};

export const ChatSourceTrigger = ({
  children,
  className,
  label,
  ...props
}: ChatSourceTriggerProps) => {
  const { domain, enablePreview, href, sourceType, title } =
    useChatSourceContext();
  const slots = chatSourceVariants();
  const isUrl = sourceType === 'url' && href;

  const inner =
    children ??
    label ??
    (isUrl ? (
      <>
        <ChatSourceIcon />
        <ChatSourceTitle>{title ?? domain}</ChatSourceTitle>
      </>
    ) : (
      <>
        <ChatSourceDocumentIcon />
        <ChatSourceTitle>{title}</ChatSourceTitle>
      </>
    ));

  const triggerClass = composeSlotClassName(slots?.trigger, className);

  if (isUrl) {
    const link = (
      <a
        className={composeSlotClassName(slots?.triggerLink, undefined)}
        href={href}
        rel="noopener noreferrer"
        target="_blank"
        {...props}
      >
        {inner}
      </a>
    );
    return (
      <span className={triggerClass} data-slot="chat-source-trigger">
        {enablePreview ? <HoverCard.Trigger>{link}</HoverCard.Trigger> : link}
      </span>
    );
  }

  return (
    <span className={triggerClass} data-slot="chat-source-trigger">
      <span
        className={composeSlotClassName(slots?.triggerLink, undefined)}
        {...props}
      >
        {inner}
      </span>
    </span>
  );
};

export const ChatSourceIcon = ({
  children,
  className,
  faviconUrl,
}: ChatSourceIconProps) => {
  const {
    domain,
    faviconUrl: ctxFavicon,
    href,
    title,
  } = useChatSourceContext();
  const slots = chatSourceVariants();
  const altText = title ?? domain ?? href ?? 'Source';
  const resolvedFavicon = faviconUrl ?? ctxFavicon;

  if (children && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<{ className?: string }>,
      {
        className: cx(
          composeSlotClassName(slots?.icon, className),
          (children as React.ReactElement<{ className?: string }>).props
            .className
        ),
        'data-slot': 'chat-source-icon',
      } as React.HTMLAttributes<HTMLElement>
    );
  }

  return resolvedFavicon ? (
    <img
      alt=""
      className={composeSlotClassName(slots?.icon, className)}
      data-slot="chat-source-icon"
      height={14}
      src={resolvedFavicon}
      width={14}
    />
  ) : (
    <span
      aria-hidden="true"
      className={composeSlotClassName(slots?.iconFallback, className)}
      data-slot="chat-source-icon-fallback"
    >
      {getInitial(altText)}
    </span>
  );
};

export const ChatSourceDocumentIcon = ({
  className,
}: {
  className?: string;
}) => {
  const slots = chatSourceVariants();
  return (
    <FileText
      className={composeSlotClassName(slots?.documentIcon, className)}
      data-slot="chat-source-document-icon"
    />
  );
};

export const ChatSourceTitle = ({
  children,
  className,
  ...props
}: ChatSourceTitleProps) => {
  const { domain, title } = useChatSourceContext();
  const slots = chatSourceVariants();
  return (
    <span
      className={composeSlotClassName(slots?.title, className)}
      data-slot="chat-source-title"
      {...props}
    >
      {children ?? title ?? domain}
    </span>
  );
};

export const ChatSourcePreview = ({
  children,
  className,
  description,
  title,
  ...props
}: ChatSourcePreviewProps) => {
  const {
    description: ctxDescription,
    domain,
    enablePreview,
    href,
    title: ctxTitle,
  } = useChatSourceContext();
  const slots = chatSourceVariants();

  if (!href || !enablePreview) return null;

  return (
    <HoverCard.Content
      className={composeTwRenderProps(className, slots?.preview())}
      data-slot="chat-source-preview"
      offset={8}
      placement="top"
      {...props}
    >
      {children ?? (
        <a
          className={composeSlotClassName(slots?.previewLink, undefined)}
          href={href}
          rel="noopener noreferrer"
          target="_blank"
        >
          <div
            className={composeSlotClassName(slots?.previewHeader, undefined)}
          >
            <ChatSourceIcon />
            <span className="text-foreground truncate text-sm">{domain}</span>
          </div>
          {(title ?? ctxTitle) && (
            <div
              className={composeSlotClassName(slots?.previewTitle, undefined)}
            >
              {title ?? ctxTitle}
            </div>
          )}
          {(description ?? ctxDescription) && (
            <div
              className={composeSlotClassName(
                slots?.previewDescription,
                undefined
              )}
            >
              {description ?? ctxDescription}
            </div>
          )}
        </a>
      )}
    </HoverCard.Content>
  );
};
