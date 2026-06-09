import { PieChartRoot } from './pie-chart';
export { pieChartVariants } from './pie-chart.styles';
import { Cell, Label, Pie, Tooltip } from 'recharts';
import { ChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
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
  TooltipContent: ChartTooltipContent,
});

export {
  PieChart,
  PieChartRoot,
  ChartTooltipContent as PieChartTooltipContent,
};
export type { PieChartRootProps } from './pie-chart';
export type { PieChartVariants } from './pie-chart.styles';
