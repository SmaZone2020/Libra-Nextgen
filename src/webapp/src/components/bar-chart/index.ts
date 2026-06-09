import { BarChartRoot } from './bar-chart';
export { barChartVariants } from './bar-chart.styles';
import { Bar, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
export {
  Bar as BarChartBar,
  CartesianGrid as BarChartGrid,
  Tooltip as BarChartTooltip,
  XAxis as BarChartXAxis,
  YAxis as BarChartYAxis,
} from 'recharts';

export const BarChart = Object.assign(BarChartRoot, {
  Bar,
  Grid: CartesianGrid,
  Root: BarChartRoot,
  Tooltip,
  TooltipContent: ChartTooltipContent,
  XAxis,
  YAxis,
});

export { BarChartRoot, ChartTooltipContent as BarChartTooltipContent };
