import type { ComponentProps } from 'react';
import {
  ChartTooltipHeader,
  ChartTooltipIndicator,
  ChartTooltipItem,
  ChartTooltipLabel,
  ChartTooltipRoot,
  ChartTooltipValue,
} from './chart-tooltip';
import { ChartTooltipContent } from './chart-tooltip-content';

export const ChartTooltip = Object.assign(ChartTooltipRoot, {
  Content: ChartTooltipContent,
  Header: ChartTooltipHeader,
  Indicator: ChartTooltipIndicator,
  Item: ChartTooltipItem,
  Label: ChartTooltipLabel,
  Root: ChartTooltipRoot,
  Value: ChartTooltipValue,
});

export type ChartTooltip = {
  ContentProps: ComponentProps<typeof ChartTooltipContent>;
  HeaderProps: ComponentProps<typeof ChartTooltipHeader>;
  IndicatorProps: ComponentProps<typeof ChartTooltipIndicator>;
  ItemProps: ComponentProps<typeof ChartTooltipItem>;
  LabelProps: ComponentProps<typeof ChartTooltipLabel>;
  Props: ComponentProps<typeof ChartTooltipRoot>;
  RootProps: ComponentProps<typeof ChartTooltipRoot>;
  ValueProps: ComponentProps<typeof ChartTooltipValue>;
};

export {
  ChartTooltipContent,
  ChartTooltipHeader,
  ChartTooltipIndicator,
  ChartTooltipItem,
  ChartTooltipLabel,
  ChartTooltipRoot,
  ChartTooltipValue,
};
export type {
  ChartTooltipHeaderProps,
  ChartTooltipIndicatorProps,
  ChartTooltipItemProps,
  ChartTooltipLabelProps,
  ChartTooltipRootProps as ChartTooltipProps,
  ChartTooltipRootProps,
  ChartTooltipValueProps,
} from './chart-tooltip';
export type { ChartTooltipVariants } from './chart-tooltip.styles';
export { chartTooltipVariants } from './chart-tooltip.styles';
export type { ChartTooltipContentProps } from './chart-tooltip-content';
