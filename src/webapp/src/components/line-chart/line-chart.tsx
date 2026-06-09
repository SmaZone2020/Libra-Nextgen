'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useMemo } from 'react';
import { LineChart, ResponsiveContainer } from 'recharts';
import { CartesianGrid, Line, Tooltip, XAxis, YAxis } from 'recharts';
import { composeSlotClassName } from '../../utils/compose';
import { ChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
import { lineChartVariants } from './line-chart.styles';

interface LineChartRootProps extends ComponentPropsWithRef<'div'> {
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

const LineChartRoot = ({
  children,
  className,
  data,
  height = 300,
  margin = { bottom: 0, left: 0, right: 8, top: 8 },
  width = '100%',
  ...props
}: LineChartRootProps) => {
  const slots = useMemo(() => lineChartVariants(), []);

  return (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="line-chart"
      {...props}
    >
      <ResponsiveContainer height={height} width={width}>
        <LineChart data={data} margin={margin}>
          {children}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export { LineChartRoot };
export type { LineChartRootProps };

export {
  CartesianGrid as LineChartGrid,
  Line as LineChartLine,
  Tooltip as LineChartTooltip,
  ChartTooltipContent as LineChartTooltipContent,
  XAxis as LineChartXAxis,
  YAxis as LineChartYAxis,
};
