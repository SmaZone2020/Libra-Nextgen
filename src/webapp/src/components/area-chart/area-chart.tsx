'use client';

import { useMemo } from 'react';
import { AreaChart, ResponsiveContainer } from 'recharts';
export {
  Area as AreaChartArea,
  CartesianGrid as AreaChartGrid,
  Tooltip as AreaChartTooltip,
  XAxis as AreaChartXAxis,
  YAxis as AreaChartYAxis,
} from 'recharts';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import { areaChartVariants } from './area-chart.styles';

export interface AreaChartRootProps extends ComponentPropsWithRef<'div'> {
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

export const AreaChartRoot = ({
  children,
  className,
  data,
  height = 300,
  margin = { bottom: 0, left: 0, right: 8, top: 8 },
  width = '100%',
  ...props
}: AreaChartRootProps) => {
  const slots = useMemo(() => areaChartVariants(), []);
  return (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="area-chart"
      {...props}
    >
      <ResponsiveContainer height={height} width={width}>
        <AreaChart data={data} margin={margin}>
          {children}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
