import { RadialChartRoot } from './radial-chart';
export { radialChartVariants } from './radial-chart.styles';
import { Cell, PolarAngleAxis, RadialBar, Tooltip } from 'recharts';
import { ChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
export {
  PolarAngleAxis as RadialChartAngleAxis,
  RadialBar as RadialChartBar,
  Cell as RadialChartCell,
  Tooltip as RadialChartTooltip,
} from 'recharts';

const RadialChart = Object.assign(RadialChartRoot, {
  AngleAxis: PolarAngleAxis,
  Bar: RadialBar,
  Cell,
  Root: RadialChartRoot,
  Tooltip,
  TooltipContent: ChartTooltipContent,
});

export { RadialChart, RadialChartRoot };
export { ChartTooltipContent as RadialChartTooltipContent } from '../chart-tooltip/chart-tooltip-content';
export type { RadialChartRootProps } from './radial-chart';
export type { RadialChartVariants } from './radial-chart.styles';
