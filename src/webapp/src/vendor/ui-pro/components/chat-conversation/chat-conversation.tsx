'use client';

import {
  type ComponentPropsWithRef,
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Tooltip } from '@heroui/react';
import { mergeRefs } from '@react-aria/utils';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { ChevronDown } from '../icons';
import { chatConversationVariants } from './chat-conversation.styles';

export interface ChatConversationRootProps extends Omit<
  ComponentPropsWithRef<'div'>,
  'resize'
> {
  children: ReactNode;
  initial?: 'instant' | 'smooth';
  resize?: 'instant' | 'smooth';
}

export interface ChatConversationContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatConversationScrollAnchorProps extends ComponentPropsWithRef<'div'> {}

export interface ChatConversationScrollButtonProps extends ComponentPropsWithRef<
  typeof Button
> {
  'aria-label'?: string;
  tooltip?: ReactNode;
}

// ─── Context ────────────────────────────────────────────────────────────────

interface ScrollState {
  hasOverflow: boolean;
  isAtBottom: boolean;
}

interface ChatConversationContextValue {
  hasOverflow: boolean;
  isAtBottom: boolean;
  measureScrollState: (options?: { preserveAtBottom?: boolean }) => void;
  resize: 'instant' | 'smooth';
  scrollToBottom: (behavior?: 'instant' | 'smooth') => void;
  slots: ReturnType<typeof chatConversationVariants>;
}

const ChatConversationContext =
  createContext<ChatConversationContextValue | null>(null);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const hasScrollOverflow = (el: HTMLElement): boolean =>
  el.scrollHeight - el.clientHeight > 4;

const isScrolledToBottom = (el: HTMLElement): boolean =>
  !hasScrollOverflow(el) ||
  el.scrollHeight - el.scrollTop - el.clientHeight <= 4;

const toBehavior = (value: 'instant' | 'smooth'): ScrollBehavior =>
  value === 'smooth' ? 'smooth' : 'auto';

const INITIAL_SCROLL_STATE: ScrollState = {
  hasOverflow: false,
  isAtBottom: true,
};

const measureScrollElement = (el: HTMLElement): ScrollState => ({
  hasOverflow: hasScrollOverflow(el),
  isAtBottom: isScrolledToBottom(el),
});

// ─── ChatConversationRoot ─────────────────────────────────────────────────────

const ChatConversationRoot = ({
  children,
  className,
  initial = 'smooth',
  onScroll,
  ref,
  resize = 'smooth',
  ...props
}: ChatConversationRootProps) => {
  const slots = useMemo(() => chatConversationVariants(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef<ScrollState>(INITIAL_SCROLL_STATE);
  const mergedRef = useMemo(() => mergeRefs(ref ?? null, scrollRef), [ref]);

  const [scrollState, setScrollState] =
    useState<ScrollState>(INITIAL_SCROLL_STATE);

  const updateState = useCallback((next: ScrollState) => {
    stateRef.current = next;
    setScrollState((prev) => {
      const isSame =
        prev.hasOverflow === next.hasOverflow &&
        prev.isAtBottom === next.isAtBottom;
      return isSame ? prev : next;
    });
  }, []);

  const measureScrollState = useCallback(
    ({ preserveAtBottom = false }: { preserveAtBottom?: boolean } = {}) => {
      const el = scrollRef.current;
      if (!el) return;
      const measured = measureScrollElement(el);
      updateState({
        hasOverflow: measured.hasOverflow,
        isAtBottom:
          (!preserveAtBottom || !stateRef.current.isAtBottom) &&
          measured.isAtBottom
            ? measured.isAtBottom
            : preserveAtBottom && stateRef.current.isAtBottom
              ? true
              : measured.isAtBottom,
      });
    },
    [updateState]
  );

  const cancelRaf = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const scrollToBottom = useCallback(
    (behavior: 'instant' | 'smooth' = resize) => {
      const el = scrollRef.current;
      if (!el) return;
      cancelRaf();
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        el.scrollTo({ behavior: toBehavior(behavior), top: el.scrollHeight });
      });
    },
    [cancelRaf, resize]
  );

  useEffect(() => cancelRaf, [cancelRaf]);

  useLayoutEffect(() => {
    measureScrollState({ preserveAtBottom: true });
    scrollToBottom(initial);
  }, [initial]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const wasAtBottom = stateRef.current.isAtBottom;
      measureScrollState({ preserveAtBottom: true });
      if (wasAtBottom) scrollToBottom(resize);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureScrollState, resize, scrollToBottom]);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      onScroll?.(event);
      updateState(measureScrollElement(event.currentTarget));
    },
    [onScroll, updateState]
  );

  const contextValue = useMemo<ChatConversationContextValue>(
    () => ({
      hasOverflow: scrollState.hasOverflow,
      isAtBottom: scrollState.isAtBottom,
      measureScrollState,
      resize,
      scrollToBottom,
      slots,
    }),
    [
      measureScrollState,
      resize,
      scrollState.hasOverflow,
      scrollState.isAtBottom,
      scrollToBottom,
      slots,
    ]
  );

  return (
    <ChatConversationContext value={contextValue}>
      <div
        ref={mergedRef}
        className={composeSlotClassName(slots?.base, className)}
        data-slot="chat-conversation"
        role="log"
        onScroll={handleScroll}
        {...props}
      >
        {children}
      </div>
    </ChatConversationContext>
  );
};

// ─── ChatConversationContent ──────────────────────────────────────────────────

const ChatConversationContent = ({
  children,
  className,
  ref,
  ...props
}: ChatConversationContentProps) => {
  const ctx = use(ChatConversationContext);
  const innerRef = useRef<HTMLDivElement>(null);
  const mergedRef = useMemo(() => mergeRefs(ref ?? null, innerRef), [ref]);

  const isAtBottom = ctx?.isAtBottom ?? true;
  const measureScrollState = ctx?.measureScrollState;
  const resize = ctx?.resize ?? 'smooth';
  const scrollToBottom = ctx?.scrollToBottom;
  const slots = ctx?.slots;

  useLayoutEffect(() => {
    measureScrollState?.({ preserveAtBottom: isAtBottom });
    if (isAtBottom) scrollToBottom?.(resize);
  }, [isAtBottom, measureScrollState, resize, scrollToBottom]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measureScrollState?.({ preserveAtBottom: isAtBottom });
      if (isAtBottom) scrollToBottom?.(resize);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isAtBottom, measureScrollState, resize, scrollToBottom]);

  return (
    <div
      ref={mergedRef}
      className={composeSlotClassName(slots?.content, className)}
      data-slot="chat-conversation-content"
      {...props}
    >
      {children}
    </div>
  );
};

// ─── ChatConversationScrollAnchor ─────────────────────────────────────────────

const ChatConversationScrollAnchor = ({
  className,
  ...props
}: ChatConversationScrollAnchorProps) => {
  const ctx = use(ChatConversationContext);
  return (
    <div
      aria-hidden="true"
      className={composeSlotClassName(ctx?.slots?.scrollAnchor, className)}
      data-slot="chat-conversation-scroll-anchor"
      {...props}
    />
  );
};

// ─── ChatConversationScrollButton ─────────────────────────────────────────────

const ChatConversationScrollButton = ({
  'aria-label': ariaLabel,
  className,
  isDisabled,
  tooltip,
  ...props
}: ChatConversationScrollButtonProps) => {
  const ctx = use(ChatConversationContext);
  const {
    hasOverflow = false,
    isAtBottom = true,
    scrollToBottom,
    slots,
  } = ctx ?? {};

  if (!scrollToBottom) return null;

  const isVisible = hasOverflow && !isAtBottom;

  const button = (
    <Button
      isIconOnly
      aria-label={ariaLabel}
      className={composeTwRenderProps(className, slots?.scrollButton())}
      data-slot="chat-conversation-scroll-button"
      isDisabled={!isVisible || isDisabled}
      size="sm"
      variant="secondary"
      onPress={() => scrollToBottom('smooth')}
      {...props}
      aria-hidden={!isVisible || undefined}
    >
      <ChevronDown className="size-4" />
    </Button>
  );

  return (
    <div
      aria-hidden={!isVisible || undefined}
      className={composeSlotClassName(slots?.scrollButtonContainer, undefined)}
      data-slot="chat-conversation-scroll-button-container"
      data-state={isVisible ? 'visible' : 'hidden'}
    >
      {tooltip ? (
        <Tooltip delay={0}>
          <Tooltip.Trigger>{button}</Tooltip.Trigger>
          <Tooltip.Content placement="top">{tooltip}</Tooltip.Content>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
};

export {
  ChatConversationContent,
  ChatConversationRoot,
  ChatConversationScrollAnchor,
  ChatConversationScrollButton,
};
