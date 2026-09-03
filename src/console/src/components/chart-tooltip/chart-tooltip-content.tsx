'use client';

import type { ReactNode } from 'react';
import {
  ChartTooltipHeader,
  ChartTooltipIndicator,
  ChartTooltipItem,
  ChartTooltipLabel,
  ChartTooltipRoot,
  ChartTooltipValue,
} from './chart-tooltip';
import type { ChartTooltipVariants } from './chart-tooltip.styles';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RechartsPayloadEntry {
  color?: string;
  dataKey?: string | number;
  fill?: string;
  name?: string;
  payload?: Record<string, unknown>;
  stroke?: string;
  value?: number | string;
}

export interface ChartTooltipContentProps extends ChartTooltipVariants {
  /** Provided by Recharts — whether the tooltip is active. */
  active?: boolean;
  className?: string;
  /** Hide the header row. @default false */
  hideHeader?: boolean;
  /** Custom formatter for the header label. */
  labelFormatter?: (label: number | string) => ReactNode;
  /** Provided by Recharts — the X-axis label for the hovered data point. */
  label?: number | string;
  /** Provided by Recharts — array of series data for the hovered point. */
  payload?: RechartsPayloadEntry[];
  /** Custom formatter for series values. */
  valueFormatter?: (value: number | string) => ReactNode;
}

// ── Component ────────────────────────────────────────────────────────────────

export const ChartTooltipContent = ({
  active,
  className,
  hideHeader = false,
  indicator,
  label,
  labelFormatter,
  payload,
  valueFormatter,
}: ChartTooltipContentProps) => {
  if (!active || !payload?.length) return null;

  const headerLabel = labelFormatter ? labelFormatter(label ?? '') : label;

  return (
    <ChartTooltipRoot
      active={active}
      className={className}
      indicator={indicator}
    >
      {!hideHeader && headerLabel != null && headerLabel !== '' && (
        <ChartTooltipHeader>{headerLabel}</ChartTooltipHeader>
      )}
      {payload.map((entry, index) => {
        const color =
          entry.stroke ||
          entry.color ||
          entry.fill ||
          (entry.payload?.fill as string | undefined);
        const displayValue = valueFormatter
          ? valueFormatter(entry.value ?? '')
          : entry.value;

        return (
          <ChartTooltipItem
            key={`${entry.dataKey ?? entry.name ?? 'series'}-${index}`}
          >
            <ChartTooltipIndicator color={color} />
            <ChartTooltipLabel>{entry.name ?? entry.dataKey}</ChartTooltipLabel>
            <ChartTooltipValue>{displayValue}</ChartTooltipValue>
          </ChartTooltipItem>
        );
      })}
    </ChartTooltipRoot>
  );
};
