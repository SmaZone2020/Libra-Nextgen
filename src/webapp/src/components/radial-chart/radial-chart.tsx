'use client';

import { useMemo } from 'react';
import { RadialBarChart, ResponsiveContainer } from 'recharts';
export {
  PolarAngleAxis as RadialChartAngleAxis,
  RadialBar as RadialChartBar,
  Cell as RadialChartCell,
  Tooltip as RadialChartTooltip,
} from 'recharts';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import { radialChartVariants } from './radial-chart.styles';

interface RadialChartRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Chart data — array of objects. Each entry becomes a concentric ring. */
  data: Record<string, number | string>[];
  /** Bar thickness in pixels. @default 10 */
  barSize?: number;
  /** Chart height in pixels. @default 300 */
  height?: number;
  /** Inner radius of the bar area. @default "30%" */
  innerRadius?: number | string;
  /** Outer radius of the bar area. @default "80%" */
  outerRadius?: number | string;
  /** Start angle in degrees. @default 90 */
  startAngle?: number;
  /** End angle in degrees. @default -270 */
  endAngle?: number;
  /** Chart width in pixels or percentage string. @default "100%" */
  width?: number | `${number}%`;
}

const RadialChartRoot = ({
  barSize = 10,
  children,
  className,
  data,
  endAngle = -270,
  height = 300,
  innerRadius = '30%',
  outerRadius = '80%',
  startAngle = 90,
  width = '100%',
  ...props
}: RadialChartRootProps) => {
  const slots = useMemo(() => radialChartVariants(), []);

  return (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="radial-chart"
      {...props}
    >
      <ResponsiveContainer height={height} width={width}>
        <RadialBarChart
          barSize={barSize}
          cx="50%"
          cy="50%"
          data={data}
          endAngle={endAngle}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          startAngle={startAngle}
        >
          {children}
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
};

export { RadialChartRoot };
export type { RadialChartRootProps };
