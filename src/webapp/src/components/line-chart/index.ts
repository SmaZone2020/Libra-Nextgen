import type { ComponentProps } from 'react';
import {
  LineChartGrid,
  LineChartLine,
  LineChartRoot,
  LineChartTooltip,
  LineChartTooltipContent,
  LineChartXAxis,
  LineChartYAxis,
} from './line-chart';

export { lineChartVariants } from './line-chart.styles';
export {
  CartesianGrid as LineChartGrid,
  Line as LineChartLine,
  Tooltip as LineChartTooltip,
  XAxis as LineChartXAxis,
  YAxis as LineChartYAxis,
} from 'recharts';

const LineChart = Object.assign(LineChartRoot, {
  Grid: LineChartGrid,
  Line: LineChartLine,
  Root: LineChartRoot,
  Tooltip: LineChartTooltip,
  TooltipContent: LineChartTooltipContent,
  XAxis: LineChartXAxis,
  YAxis: LineChartYAxis,
});

export { LineChart, LineChartRoot, LineChartTooltipContent };

export type { LineChartRootProps } from './line-chart';
export type { LineChartVariants } from './line-chart.styles';

export type LineChart = {
  GridProps: ComponentProps<typeof LineChartGrid>;
  LineProps: ComponentProps<typeof LineChartLine>;
  Props: ComponentProps<typeof LineChartRoot>;
  RootProps: ComponentProps<typeof LineChartRoot>;
  TooltipContentProps: ComponentProps<typeof LineChartTooltipContent>;
  TooltipProps: ComponentProps<typeof LineChartTooltip>;
  XAxisProps: ComponentProps<typeof LineChartXAxis>;
  YAxisProps: ComponentProps<typeof LineChartYAxis>;
};
