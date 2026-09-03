'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Disclosure } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { chatSourcesVariants } from './chat-source.styles';

interface ChatSourcesContextValue {
  slots: ReturnType<typeof chatSourcesVariants>;
}

const ChatSourcesContext = createContext<ChatSourcesContextValue>({
  slots: chatSourcesVariants(),
});

const useSlots = () => {
  const { slots } = useContext(ChatSourcesContext);
  const fallback = useMemo(() => chatSourcesVariants(), []);
  return slots ?? fallback;
};

export interface ChatSourcesRootProps extends ComponentPropsWithRef<
  typeof Disclosure
> {
  children: ReactNode;
}

export interface ChatSourcesTriggerProps extends ComponentPropsWithRef<
  typeof Disclosure.Trigger
> {
  children: ReactNode;
}

export interface ChatSourcesContentProps extends ComponentPropsWithRef<
  typeof Disclosure.Content
> {
  children: ReactNode;
}

export interface ChatSourcesListProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const ChatSourcesRoot = ({
  children,
  className,
  ...props
}: ChatSourcesRootProps) => {
  const slots = useMemo(() => chatSourcesVariants(), []);
  return (
    <ChatSourcesContext.Provider value={{ slots }}>
      <Disclosure
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="chat-sources"
        {...props}
      >
        {children}
      </Disclosure>
    </ChatSourcesContext.Provider>
  );
};

export const ChatSourcesTrigger = ({
  children,
  className,
  ...props
}: ChatSourcesTriggerProps) => {
  const slots = useSlots();
  return (
    <Disclosure.Heading>
      <Disclosure.Trigger
        className={composeTwRenderProps(className, slots?.trigger())}
        data-slot="chat-sources-trigger"
        {...props}
      >
        <span className={composeSlotClassName(slots?.triggerLabel, undefined)}>
          {children}
        </span>
        <Disclosure.Indicator className="text-muted size-3.5 shrink-0" />
      </Disclosure.Trigger>
    </Disclosure.Heading>
  );
};

export const ChatSourcesContent = ({
  children,
  className,
  ...props
}: ChatSourcesContentProps) => {
  const slots = useSlots();
  return (
    <Disclosure.Content
      className={composeTwRenderProps(className, slots?.content())}
      data-slot="chat-sources-content"
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

export const ChatSourcesList = ({
  children,
  className,
  ...props
}: ChatSourcesListProps) => {
  const slots = useSlots();
  return (
    <div
      className={composeSlotClassName(slots?.list, className)}
      data-slot="chat-sources-list"
      {...props}
    >
      {children}
    </div>
  );
};
