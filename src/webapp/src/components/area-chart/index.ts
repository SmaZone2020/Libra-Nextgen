import { AreaChartRoot } from './area-chart';
export { areaChartVariants } from './area-chart.styles';
import { Area, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
export {
  Area as AreaChartArea,
  CartesianGrid as AreaChartGrid,
  Tooltip as AreaChartTooltip,
  XAxis as AreaChartXAxis,
  YAxis as AreaChartYAxis,
} from 'recharts';

export const AreaChart = Object.assign(AreaChartRoot, {
  Area,
  Grid: CartesianGrid,
  Root: AreaChartRoot,
  Tooltip,
  TooltipContent: ChartTooltipContent,
  XAxis,
  YAxis,
});

export { AreaChartRoot, ChartTooltipContent as AreaChartTooltipContent };
