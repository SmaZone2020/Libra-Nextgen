'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Disclosure } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { TextShimmer } from '../text-shimmer/text-shimmer';
import { chatToolGroupVariants } from './chat-tool.styles';

interface ChatToolGroupContextValue {
  active: boolean;
  slots: ReturnType<typeof chatToolGroupVariants>;
}

const ChatToolGroupContext = createContext<ChatToolGroupContextValue>({
  active: false,
  slots: chatToolGroupVariants(),
});

const useSlots = () => {
  const { slots } = useContext(ChatToolGroupContext);
  const fallback = useMemo(() => chatToolGroupVariants(), []);
  return slots ?? fallback;
};

export interface ChatToolGroupRootProps extends ComponentPropsWithRef<
  typeof Disclosure
> {
  active?: boolean;
  children: ReactNode;
}

export interface ChatToolGroupTriggerProps extends ComponentPropsWithRef<
  typeof Disclosure.Trigger
> {
  children: ReactNode;
}

export interface ChatToolGroupContentProps extends ComponentPropsWithRef<
  typeof Disclosure.Content
> {
  children: ReactNode;
}

export const ChatToolGroupRoot = ({
  active = false,
  children,
  className,
  ...props
}: ChatToolGroupRootProps) => {
  const slots = useMemo(() => chatToolGroupVariants(), []);
  return (
    <ChatToolGroupContext.Provider value={{ active, slots }}>
      <Disclosure
        className={composeTwRenderProps(className, slots?.base())}
        data-active={active || undefined}
        data-slot="chat-tool-group"
        {...props}
      >
        {children}
      </Disclosure>
    </ChatToolGroupContext.Provider>
  );
};

export const ChatToolGroupTrigger = ({
  children,
  className,
  ...props
}: ChatToolGroupTriggerProps) => {
  const { active } = useContext(ChatToolGroupContext);
  const slots = useSlots();
  const content = active ? <TextShimmer>{children}</TextShimmer> : children;

  return (
    <Disclosure.Heading>
      <Disclosure.Trigger
        className={composeTwRenderProps(className, slots?.trigger())}
        data-slot="chat-tool-group-trigger"
        {...props}
      >
        <span className={composeSlotClassName(slots?.triggerLabel, undefined)}>
          {content}
        </span>
        <Disclosure.Indicator className="text-muted size-3.5 shrink-0" />
      </Disclosure.Trigger>
    </Disclosure.Heading>
  );
};

export const ChatToolGroupContent = ({
  children,
  className,
  ...props
}: ChatToolGroupContentProps) => {
  const slots = useSlots();
  return (
    <Disclosure.Content
      className={composeTwRenderProps(className, slots?.content())}
      data-slot="chat-tool-group-content"
      {...props}
    >
      <Disclosure.Body>
        <div className={composeSlotClassName(slots?.contentBody, undefined)}>
          {children}
        </div>
      </Disclosure.Body>
    </Disclosure.Content>
  );
};
