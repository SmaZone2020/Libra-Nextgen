import type { ComponentProps } from 'react';
import { Cell, Label, Pie, Tooltip } from 'recharts';
import { ChartTooltipContent as PieChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
import type {
  PieChartCell,
  PieChartLabel,
  PieChartPie,
  PieChartTooltip,
} from './pie-chart';
import { PieChartRoot } from './pie-chart';

export { pieChartVariants } from './pie-chart.styles';
export {
  Cell as PieChartCell,
  Label as PieChartLabel,
  Pie as PieChartPie,
  Tooltip as PieChartTooltip,
} from 'recharts';

const PieChart = Object.assign(PieChartRoot, {
  Cell,
  Label,
  Pie,
  Root: PieChartRoot,
  Tooltip,
  TooltipContent: PieChartTooltipContent,
});

export { PieChart, PieChartRoot, PieChartTooltipContent };
export type {
  PieChartRootProps as PieChartProps,
  PieChartRootProps,
} from './pie-chart';
export type { PieChartVariants } from './pie-chart.styles';

export type PieChart = {
  CellProps: ComponentProps<typeof PieChartCell>;
  LabelProps: ComponentProps<typeof PieChartLabel>;
  PieProps: ComponentProps<typeof PieChartPie>;
  Props: ComponentProps<typeof PieChartRoot>;
  RootProps: ComponentProps<typeof PieChartRoot>;
  TooltipContentProps: ComponentProps<typeof PieChartTooltipContent>;
  TooltipProps: ComponentProps<typeof PieChartTooltip>;
};
