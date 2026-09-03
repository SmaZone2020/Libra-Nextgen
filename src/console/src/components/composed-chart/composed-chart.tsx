'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useMemo } from 'react';
import { ComposedChart, ResponsiveContainer } from 'recharts';
export {
  Area as ComposedChartArea,
  Bar as ComposedChartBar,
  CartesianGrid as ComposedChartGrid,
  Line as ComposedChartLine,
  Tooltip as ComposedChartTooltip,
  XAxis as ComposedChartXAxis,
  YAxis as ComposedChartYAxis,
} from 'recharts';
import { composeSlotClassName } from '../../utils/compose';
import { ChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
import { composedChartVariants } from './composed-chart.styles';

export { ChartTooltipContent as ComposedChartTooltipContent };

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComposedChartRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Chart data — array of objects with numeric/string fields for each series. */
  data: Record<string, number | string>[];
  /** Chart height in pixels. @default 300 */
  height?: number;
  /** Recharts margin. @default { top: 8, right: 8, bottom: 0, left: 0 } */
  margin?: {
    bottom?: number;
    left?: number;
    right?: number;
    top?: number;
  };
  /** Chart width in pixels or percentage string like "100%". @default "100%" */
  width?: number | `${number}%`;
}

// ── Component ────────────────────────────────────────────────────────────────

export const ComposedChartRoot = ({
  children,
  className,
  data,
  height = 300,
  margin = { bottom: 0, left: 0, right: 8, top: 8 },
  width = '100%',
  ...props
}: ComposedChartRootProps) => {
  const slots = useMemo(() => composedChartVariants(), []);

  return (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="composed-chart"
      {...props}
    >
      <ResponsiveContainer height={height} width={width}>
        <ComposedChart data={data} margin={margin}>
          {children}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};
