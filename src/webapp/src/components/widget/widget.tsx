'use client';

import type { ComponentPropsWithRef } from 'react';
import React from 'react';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { DOMRenderProps } from '@heroui/react';
import { dom } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import { widgetVariants } from './widget.styles';

type WidgetContextValue = {
  slots: ReturnType<typeof widgetVariants>;
};

const WidgetContext = createContext<WidgetContextValue>(
  {} as WidgetContextValue
);

interface WidgetRootProps<
  E extends keyof React.JSX.IntrinsicElements = 'div',
> extends DOMRenderProps<E, undefined> {
  children: ReactNode;
  className?: string;
}

const WidgetRoot = <E extends keyof React.JSX.IntrinsicElements = 'div'>({
  children,
  className,
  ...props
}: WidgetRootProps<E> &
  Omit<React.JSX.IntrinsicElements[E], keyof WidgetRootProps<E>>) => {
  const slots = useMemo(() => widgetVariants(), []);
  return (
    <WidgetContext.Provider value={{ slots }}>
      <dom.div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="widget"
        {...(props as object)}
      >
        {children}
      </dom.div>
    </WidgetContext.Provider>
  );
};

interface WidgetHeaderProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const WidgetHeader = ({ children, className, ...props }: WidgetHeaderProps) => {
  const { slots } = useContext(WidgetContext);
  return (
    <div
      className={composeSlotClassName(slots?.header, className)}
      data-slot="widget-header"
      {...props}
    >
      {children}
    </div>
  );
};

interface WidgetTitleProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const WidgetTitle = ({ children, className, ...props }: WidgetTitleProps) => {
  const { slots } = useContext(WidgetContext);
  return (
    <span
      className={composeSlotClassName(slots?.title, className)}
      data-slot="widget-title"
      {...props}
    >
      {children}
    </span>
  );
};

interface WidgetDescriptionProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const WidgetDescription = ({
  children,
  className,
  ...props
}: WidgetDescriptionProps) => {
  const { slots } = useContext(WidgetContext);
  return (
    <span
      className={composeSlotClassName(slots?.description, className)}
      data-slot="widget-description"
      {...props}
    >
      {children}
    </span>
  );
};

interface WidgetContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const WidgetContent = ({
  children,
  className,
  ...props
}: WidgetContentProps) => {
  const { slots } = useContext(WidgetContext);
  return (
    <div
      className={composeSlotClassName(slots?.content, className)}
      data-slot="widget-content"
      {...props}
    >
      {children}
    </div>
  );
};

interface WidgetFooterProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const WidgetFooter = ({ children, className, ...props }: WidgetFooterProps) => {
  const { slots } = useContext(WidgetContext);
  return (
    <div
      className={composeSlotClassName(slots?.footer, className)}
      data-slot="widget-footer"
      {...props}
    >
      {children}
    </div>
  );
};

interface WidgetLegendProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const WidgetLegend = ({ children, className, ...props }: WidgetLegendProps) => {
  const { slots } = useContext(WidgetContext);
  return (
    <div
      className={composeSlotClassName(slots?.legend, className)}
      data-slot="widget-legend"
      {...props}
    >
      {children}
    </div>
  );
};

interface WidgetLegendItemProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Dot color. Pass a CSS color string or variable. */
  color: string;
}

const WidgetLegendItem = ({
  children,
  className,
  color,
  ...props
}: WidgetLegendItemProps) => {
  const { slots } = useContext(WidgetContext);
  return (
    <div
      className={composeSlotClassName(slots?.legendItem, className)}
      data-slot="widget-legend-item"
      {...props}
    >
      <span
        className={composeSlotClassName(slots?.legendItemDot)}
        data-slot="widget-legend-item-dot"
        style={{ backgroundColor: color }}
      />
      <span
        className={composeSlotClassName(slots?.legendItemLabel)}
        data-slot="widget-legend-item-label"
      >
        {children}
      </span>
    </div>
  );
};

export {
  WidgetContent,
  WidgetDescription,
  WidgetFooter,
  WidgetHeader,
  WidgetLegend,
  WidgetLegendItem,
  WidgetRoot,
  WidgetTitle,
};
export type {
  WidgetContentProps,
  WidgetDescriptionProps,
  WidgetFooterProps,
  WidgetHeaderProps,
  WidgetLegendItemProps,
  WidgetLegendProps,
  WidgetRootProps,
  WidgetTitleProps,
};
