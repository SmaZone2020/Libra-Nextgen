'use client';

import { useMemo } from 'react';
import {
  RadarChart as RechartsRadarChart,
  ResponsiveContainer,
} from 'recharts';
export {
  PolarAngleAxis as RadarChartAngleAxis,
  PolarGrid as RadarChartGrid,
  Radar as RadarChartRadar,
  PolarRadiusAxis as RadarChartRadiusAxis,
  Tooltip as RadarChartTooltip,
} from 'recharts';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import { radarChartVariants } from './radar-chart.styles';

interface RadarChartRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Chart data — array of objects with a category key and numeric series fields. */
  data: Record<string, number | string>[];
  /** Chart height in pixels. @default 300 */
  height?: number;
  /** Chart width in pixels or percentage string. @default "100%" */
  width?: number | `${number}%`;
}

const RadarChartRoot = ({
  children,
  className,
  data,
  height = 300,
  width = '100%',
  ...props
}: RadarChartRootProps) => {
  const slots = useMemo(() => radarChartVariants(), []);

  return (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="radar-chart"
      {...props}
    >
      <ResponsiveContainer height={height} width={width}>
        <RechartsRadarChart cx="50%" cy="50%" data={data}>
          {children}
        </RechartsRadarChart>
      </ResponsiveContainer>
    </div>
  );
};

export { RadarChartRoot };
export type { RadarChartRootProps };
