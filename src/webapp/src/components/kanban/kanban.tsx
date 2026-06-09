'use client';

import type { ComponentPropsWithRef, CSSProperties, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Button as ButtonPrimitive } from 'react-aria-components/Button';
import { GridList, GridListItem } from 'react-aria-components/GridList';
import { DropIndicator as DropIndicatorPrimitive } from 'react-aria-components/useDragAndDrop';
import { domMax, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { ScrollShadow } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { KanbanVariants } from './kanban.styles';
import { kanbanVariants } from './kanban.styles';

interface KanbanContextValue {
  slots?: ReturnType<typeof kanbanVariants>;
}

const KanbanContext = createContext<KanbanContextValue>({});

interface KanbanRootProps extends Omit<
  ComponentPropsWithRef<typeof ScrollShadow>,
  'size'
> {
  /** Size variant controlling card padding, font size, and column width. @default "md" */
  size?: KanbanVariants['size'];
}

const KanbanRoot = ({
  children,
  className,
  size,
  ...props
}: KanbanRootProps) => {
  const slots = useMemo(() => kanbanVariants({ size }), [size]);

  return (
    <KanbanContext.Provider value={{ slots }}>
      <LazyMotion features={domMax}>
        <ScrollShadow
          className={composeSlotClassName(slots?.base, className)}
          data-slot="kanban"
          orientation="horizontal"
          {...props}
        >
          {children}
        </ScrollShadow>
      </LazyMotion>
    </KanbanContext.Provider>
  );
};

interface KanbanColumnProps extends ComponentPropsWithRef<'section'> {}

const KanbanColumn = ({ children, className, ...props }: KanbanColumnProps) => {
  const { slots } = useContext(KanbanContext);

  return (
    <section
      className={composeSlotClassName(slots?.column, className)}
      data-slot="kanban-column"
      {...props}
    >
      {children}
    </section>
  );
};

interface KanbanColumnBodyProps extends ComponentPropsWithRef<'div'> {}

const KanbanColumnBody = ({
  children,
  className,
  ...props
}: KanbanColumnBodyProps) => {
  const { slots } = useContext(KanbanContext);

  return (
    <div
      className={composeSlotClassName(slots?.columnBody, className)}
      data-slot="kanban-column-body"
      {...props}
    >
      {children}
    </div>
  );
};

interface KanbanColumnHeaderProps extends ComponentPropsWithRef<'header'> {}

const KanbanColumnHeader = ({
  children,
  className,
  ...props
}: KanbanColumnHeaderProps) => {
  const { slots } = useContext(KanbanContext);

  return (
    <header
      className={composeSlotClassName(slots?.columnHeader, className)}
      data-slot="kanban-column-header"
      {...props}
    >
      {children}
    </header>
  );
};

interface KanbanColumnActionsProps extends ComponentPropsWithRef<'div'> {}

const KanbanColumnActions = ({
  children,
  className,
  ...props
}: KanbanColumnActionsProps) => {
  const { slots } = useContext(KanbanContext);

  return (
    <div
      className={composeSlotClassName(slots?.columnActions, className)}
      data-slot="kanban-column-actions"
      {...props}
    >
      {children}
    </div>
  );
};

interface KanbanColumnIndicatorProps extends ComponentPropsWithRef<'span'> {}

const KanbanColumnIndicator = ({
  children,
  className,
  ...props
}: KanbanColumnIndicatorProps) => {
  const { slots } = useContext(KanbanContext);

  return (
    <span
      className={composeSlotClassName(slots?.columnIndicator, className)}
      data-slot="kanban-column-indicator"
      {...props}
    >
      {children}
    </span>
  );
};

interface KanbanColumnTitleProps extends ComponentPropsWithRef<'h3'> {}

const KanbanColumnTitle = ({
  children,
  className,
  ...props
}: KanbanColumnTitleProps) => {
  const { slots } = useContext(KanbanContext);

  return (
    <h3
      className={composeSlotClassName(slots?.columnTitle, className)}
      data-slot="kanban-column-title"
      {...props}
    >
      {children}
    </h3>
  );
};

interface KanbanColumnCountProps extends ComponentPropsWithRef<'span'> {}

const KanbanColumnCount = ({
  children,
  className,
  ...props
}: KanbanColumnCountProps) => {
  const { slots } = useContext(KanbanContext);

  return (
    <span
      className={composeSlotClassName(slots?.columnCount, className)}
      data-slot="kanban-column-count"
      {...props}
    >
      {children}
    </span>
  );
};

const SPRING_TRANSITION = {
  bounce: 0.15,
  duration: 0.35,
  type: 'spring' as const,
};

interface KanbanCardListProps<T extends object> extends ComponentPropsWithRef<
  typeof GridList<T>
> {}

const KanbanCardList = <T extends object>({
  children,
  className,
  renderEmptyState,
  selectionMode = 'none',
  ...props
}: KanbanCardListProps<T>) => {
  const { slots } = useContext(KanbanContext);

  const emptyState = renderEmptyState
    ? (...args: Parameters<NonNullable<typeof renderEmptyState>>) => (
        <div className={slots?.empty()} data-slot="kanban-empty">
          {renderEmptyState(...args)}
        </div>
      )
    : undefined;

  return (
    <GridList
      className={composeTwRenderProps(className, slots?.cardList())}
      data-slot="kanban-card-list"
      renderEmptyState={emptyState}
      selectionMode={selectionMode}
      {...props}
    >
      {children}
    </GridList>
  );
};

interface KanbanCardProps<T extends object> extends ComponentPropsWithRef<
  typeof GridListItem<T>
> {}

const KanbanCard = <T extends object>({
  children,
  className,
  ...props
}: KanbanCardProps<T>) => {
  const { slots } = useContext(KanbanContext);

  return (
    <GridListItem
      className={composeTwRenderProps(className, slots?.card())}
      data-slot="kanban-card"
      {...props}
    >
      {(renderProps) => (
        <m.div
          layout
          className={slots?.cardContent()}
          data-slot="kanban-card-content"
          transition={{ layout: SPRING_TRANSITION }}
        >
          {typeof children === 'function' ? children(renderProps) : children}
        </m.div>
      )}
    </GridListItem>
  );
};

interface KanbanDropIndicatorProps extends ComponentPropsWithRef<
  typeof DropIndicatorPrimitive
> {
  /** Height of the drop placeholder. Typically set to the dragged card's height. */
  height?: number;
}

const KanbanDropIndicator = ({
  className,
  height,
  style,
  ...props
}: KanbanDropIndicatorProps) => {
  const { slots } = useContext(KanbanContext);

  const baseStyle = typeof style === 'function' ? undefined : style;
  const resolvedStyle: React.CSSProperties | undefined =
    height && height > 0
      ? ({
          '--kanban-drop-height': `${height}px`,
          ...baseStyle,
        } as React.CSSProperties)
      : baseStyle;

  return (
    <DropIndicatorPrimitive
      className={composeTwRenderProps(className, slots?.dropIndicator())}
      data-slot="kanban-drop-indicator"
      style={resolvedStyle}
      {...props}
    />
  );
};

interface KanbanScrollShadowProps extends ComponentPropsWithRef<
  typeof ScrollShadow
> {}

const KanbanScrollShadow = ({
  children,
  className,
  ...props
}: KanbanScrollShadowProps) => {
  const { slots } = useContext(KanbanContext);

  return (
    <ScrollShadow
      className={composeSlotClassName(slots?.scrollShadow, className)}
      data-slot="kanban-scroll-shadow"
      {...props}
    >
      {children}
    </ScrollShadow>
  );
};

interface KanbanDragHandleProps extends ComponentPropsWithRef<
  typeof ButtonPrimitive
> {}

const KanbanDragHandle = ({
  children,
  className,
  ...props
}: KanbanDragHandleProps) => {
  const { slots } = useContext(KanbanContext);

  return (
    <ButtonPrimitive
      className={composeTwRenderProps(className, slots?.dragHandle())}
      data-slot="kanban-drag-handle"
      slot="drag"
      {...props}
    >
      {children ?? '≡'}
    </ButtonPrimitive>
  );
};

export {
  KanbanCard,
  KanbanCardList,
  KanbanColumn,
  KanbanColumnActions,
  KanbanColumnBody,
  KanbanColumnCount,
  KanbanColumnHeader,
  KanbanColumnIndicator,
  KanbanColumnTitle,
  KanbanDragHandle,
  KanbanDropIndicator,
  KanbanRoot,
  KanbanScrollShadow,
};

export type {
  KanbanCardListProps,
  KanbanCardProps,
  KanbanColumnActionsProps,
  KanbanColumnBodyProps,
  KanbanColumnCountProps,
  KanbanColumnHeaderProps,
  KanbanColumnIndicatorProps,
  KanbanColumnProps,
  KanbanColumnTitleProps,
  KanbanDragHandleProps,
  KanbanDropIndicatorProps,
  KanbanRootProps,
  KanbanScrollShadowProps,
};
