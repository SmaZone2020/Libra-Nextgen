'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { DOMRenderProps } from '@heroui/react';
import { dom } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import type { EmptyStateVariants } from './empty-state.styles';
import { emptyStateVariants } from './empty-state.styles';

// ---- Context ----

type EmptyStateContextValue = {
  slots?: ReturnType<typeof emptyStateVariants>;
};

const EmptyStateContext = createContext<EmptyStateContextValue>({});

// ---- Types ----

export interface EmptyStateRootProps<
  E extends keyof React.JSX.IntrinsicElements = 'div',
> extends DOMRenderProps<E, undefined> {
  children: ReactNode;
  className?: string;
  /** Size variant. @default "md" */
  size?: EmptyStateVariants['size'];
}

export interface EmptyStateHeaderProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface EmptyStateMediaProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Media display variant. "icon" adds a circular muted background. @default "default" */
  variant?: 'default' | 'icon';
}

export interface EmptyStateTitleProps extends ComponentPropsWithRef<'h3'> {
  children: ReactNode;
}

export interface EmptyStateDescriptionProps extends ComponentPropsWithRef<'p'> {
  children: ReactNode;
}

export interface EmptyStateContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

// ---- Components ----

export const EmptyStateRoot = <
  E extends keyof React.JSX.IntrinsicElements = 'div',
>({
  children,
  className,
  size = 'md',
  ...props
}: EmptyStateRootProps<E> &
  Omit<React.JSX.IntrinsicElements[E], keyof EmptyStateRootProps<E>>) => {
  const slots = useMemo(() => emptyStateVariants({ size }), [size]);
  return (
    <EmptyStateContext.Provider value={{ slots }}>
      <dom.div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="empty-state"
        {...(props as object)}
      >
        {children}
      </dom.div>
    </EmptyStateContext.Provider>
  );
};

export const EmptyStateHeader = ({
  children,
  className,
  ...props
}: EmptyStateHeaderProps) => {
  const { slots } = useContext(EmptyStateContext);
  return (
    <div
      className={composeSlotClassName(slots?.header, className)}
      data-slot="empty-state-header"
      {...props}
    >
      {children}
    </div>
  );
};

export const EmptyStateMedia = ({
  children,
  className,
  variant = 'default',
  ...props
}: EmptyStateMediaProps) => {
  const { slots } = useContext(EmptyStateContext);
  return (
    <div
      className={composeSlotClassName(slots?.media, className)}
      data-slot="empty-state-media"
      data-variant={variant}
      {...props}
    >
      {children}
    </div>
  );
};

export const EmptyStateTitle = ({
  children,
  className,
  ...props
}: EmptyStateTitleProps) => {
  const { slots } = useContext(EmptyStateContext);
  return (
    <h3
      className={composeSlotClassName(slots?.title, className)}
      data-slot="empty-state-title"
      {...props}
    >
      {children}
    </h3>
  );
};

export const EmptyStateDescription = ({
  children,
  className,
  ...props
}: EmptyStateDescriptionProps) => {
  const { slots } = useContext(EmptyStateContext);
  return (
    <p
      className={composeSlotClassName(slots?.description, className)}
      data-slot="empty-state-description"
      {...props}
    >
      {children}
    </p>
  );
};

export const EmptyStateContent = ({
  children,
  className,
  ...props
}: EmptyStateContentProps) => {
  const { slots } = useContext(EmptyStateContext);
  return (
    <div
      className={composeSlotClassName(slots?.content, className)}
      data-slot="empty-state-content"
      {...props}
    >
      {children}
    </div>
  );
};
