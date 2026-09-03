'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import type { ChartTooltipVariants } from './chart-tooltip.styles';
import { chartTooltipVariants } from './chart-tooltip.styles';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChartTooltipRootProps
  extends ComponentPropsWithRef<'div'>, ChartTooltipVariants {
  /** Controls visibility. When false, the tooltip is not rendered. */
  active?: boolean;
  children: ReactNode;
}

export interface ChartTooltipHeaderProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChartTooltipItemProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChartTooltipIndicatorProps extends ComponentPropsWithRef<'span'> {
  /** Color for the indicator. Accepts any CSS color value. */
  color?: string;
}

export interface ChartTooltipLabelProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

export interface ChartTooltipValueProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

// ── Context ──────────────────────────────────────────────────────────────────

interface ChartTooltipContextValue {
  slots?: ReturnType<typeof chartTooltipVariants>;
}

const ChartTooltipContext = createContext<ChartTooltipContextValue>({});

// ── Components ───────────────────────────────────────────────────────────────

export const ChartTooltipRoot = ({
  active = true,
  children,
  className,
  indicator,
  ...props
}: ChartTooltipRootProps) => {
  const slots = useMemo(() => chartTooltipVariants({ indicator }), [indicator]);

  if (!active) return null;

  return (
    <ChartTooltipContext value={{ slots }}>
      <div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="chart-tooltip"
        {...props}
      >
        {children}
      </div>
    </ChartTooltipContext>
  );
};

export const ChartTooltipHeader = ({
  children,
  className,
  ...props
}: ChartTooltipHeaderProps) => {
  const { slots } = useContext(ChartTooltipContext);

  return (
    <div
      className={composeSlotClassName(slots?.header, className)}
      data-slot="chart-tooltip-header"
      {...props}
    >
      {children}
    </div>
  );
};

export const ChartTooltipItem = ({
  children,
  className,
  ...props
}: ChartTooltipItemProps) => {
  const { slots } = useContext(ChartTooltipContext);

  return (
    <div
      className={composeSlotClassName(slots?.item, className)}
      data-slot="chart-tooltip-item"
      {...props}
    >
      {children}
    </div>
  );
};

export const ChartTooltipIndicator = ({
  className,
  color,
  style,
  ...props
}: ChartTooltipIndicatorProps) => {
  const { slots } = useContext(ChartTooltipContext);

  return (
    <span
      className={composeSlotClassName(slots?.indicator, className)}
      data-slot="chart-tooltip-indicator"
      style={{ backgroundColor: color, ...style }}
      {...props}
    />
  );
};

export const ChartTooltipLabel = ({
  children,
  className,
  ...props
}: ChartTooltipLabelProps) => {
  const { slots } = useContext(ChartTooltipContext);

  return (
    <span
      className={composeSlotClassName(slots?.label, className)}
      data-slot="chart-tooltip-label"
      {...props}
    >
      {children}
    </span>
  );
};

export const ChartTooltipValue = ({
  children,
  className,
  ...props
}: ChartTooltipValueProps) => {
  const { slots } = useContext(ChartTooltipContext);

  return (
    <span
      className={composeSlotClassName(slots?.value, className)}
      data-slot="chart-tooltip-value"
      {...props}
    >
      {children}
    </span>
  );
};
