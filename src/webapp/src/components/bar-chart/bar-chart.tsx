'use client';

import { useMemo } from 'react';
import { BarChart, ResponsiveContainer } from 'recharts';
export {
  Bar as BarChartBar,
  CartesianGrid as BarChartGrid,
  Tooltip as BarChartTooltip,
  XAxis as BarChartXAxis,
  YAxis as BarChartYAxis,
} from 'recharts';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import { barChartVariants } from './bar-chart.styles';

export interface BarChartRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Chart data — array of objects with numeric/string fields for each series. */
  data: Record<string, number | string>[];
  /** Chart height in pixels. @default 300 */
  height?: number;
  /** Bar layout direction. Use "vertical" for horizontal bar charts. @default "horizontal" */
  layout?: 'horizontal' | 'vertical';
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

export const BarChartRoot = ({
  children,
  className,
  data,
  height = 300,
  layout,
  margin = { bottom: 0, left: 0, right: 8, top: 8 },
  width = '100%',
  ...props
}: BarChartRootProps) => {
  const slots = useMemo(() => barChartVariants(), []);
  return (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="bar-chart"
      {...props}
    >
      <ResponsiveContainer height={height} width={width}>
        <BarChart data={data} layout={layout} margin={margin}>
          {children}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
