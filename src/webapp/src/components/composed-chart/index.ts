import type { ComponentProps } from 'react';
import {
  ComposedChartArea,
  ComposedChartBar,
  ComposedChartGrid,
  ComposedChartLine,
  ComposedChartRoot,
  ComposedChartTooltip,
  ComposedChartTooltipContent,
  ComposedChartXAxis,
  ComposedChartYAxis,
} from './composed-chart';

export const ComposedChart = Object.assign(ComposedChartRoot, {
  Area: ComposedChartArea,
  Bar: ComposedChartBar,
  Grid: ComposedChartGrid,
  Line: ComposedChartLine,
  Root: ComposedChartRoot,
  Tooltip: ComposedChartTooltip,
  TooltipContent: ComposedChartTooltipContent,
  XAxis: ComposedChartXAxis,
  YAxis: ComposedChartYAxis,
});

export type ComposedChart = {
  AreaProps: ComponentProps<typeof ComposedChartArea>;
  BarProps: ComponentProps<typeof ComposedChartBar>;
  GridProps: ComponentProps<typeof ComposedChartGrid>;
  LineProps: ComponentProps<typeof ComposedChartLine>;
  Props: ComponentProps<typeof ComposedChartRoot>;
  RootProps: ComponentProps<typeof ComposedChartRoot>;
  TooltipContentProps: ComponentProps<typeof ComposedChartTooltipContent>;
  TooltipProps: ComponentProps<typeof ComposedChartTooltip>;
  XAxisProps: ComponentProps<typeof ComposedChartXAxis>;
  YAxisProps: ComponentProps<typeof ComposedChartYAxis>;
};

export {
  ComposedChartArea,
  ComposedChartBar,
  ComposedChartGrid,
  ComposedChartLine,
  ComposedChartRoot,
  ComposedChartTooltip,
  ComposedChartTooltipContent,
  ComposedChartXAxis,
  ComposedChartYAxis,
};
export type { ComposedChartRootProps } from './composed-chart';
export type { ComposedChartVariants } from './composed-chart.styles';
export { composedChartVariants } from './composed-chart.styles';
