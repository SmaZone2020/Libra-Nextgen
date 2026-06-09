import { RadarChartRoot } from './radar-chart';
export { radarChartVariants } from './radar-chart.styles';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  Tooltip,
} from 'recharts';
import { ChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
export {
  PolarAngleAxis as RadarChartAngleAxis,
  PolarGrid as RadarChartGrid,
  Radar as RadarChartRadar,
  PolarRadiusAxis as RadarChartRadiusAxis,
  Tooltip as RadarChartTooltip,
} from 'recharts';
import type { ComponentProps } from 'react';

const RadarChart = Object.assign(RadarChartRoot, {
  AngleAxis: PolarAngleAxis,
  Grid: PolarGrid,
  Radar,
  RadiusAxis: PolarRadiusAxis,
  Root: RadarChartRoot,
  Tooltip,
  TooltipContent: ChartTooltipContent,
});

export { RadarChart, RadarChartRoot };
export { ChartTooltipContent as RadarChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
export type { RadarChartRootProps } from './radar-chart';
export type { RadarChartVariants } from './radar-chart.styles';
export type { RadarChart as RadarChartType };
