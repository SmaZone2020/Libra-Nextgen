import type { ComponentProps } from 'react';
import {
  KPIActions,
  KPIChart,
  KPIContent,
  KPIFooter,
  KPIHeader,
  KPIIcon,
  KPIProgress,
  KPIRoot,
  KPISeparator,
  KPITitle,
  KPITrend,
  KPIValue,
} from './kpi';

export { kpiVariants } from './kpi.styles';

const KPI = Object.assign(KPIRoot, {
  Actions: KPIActions,
  Chart: KPIChart,
  Content: KPIContent,
  Footer: KPIFooter,
  Header: KPIHeader,
  Icon: KPIIcon,
  Progress: KPIProgress,
  Root: KPIRoot,
  Separator: KPISeparator,
  Title: KPITitle,
  Trend: KPITrend,
  Value: KPIValue,
});

export {
  KPI,
  KPIActions,
  KPIChart,
  KPIContent,
  KPIFooter,
  KPIHeader,
  KPIIcon,
  KPIProgress,
  KPIRoot,
  KPISeparator,
  KPITitle,
  KPITrend,
  KPIValue,
};

export type {
  KPIActionsProps,
  KPIChartProps,
  KPIContentProps,
  KPIFooterProps,
  KPIHeaderProps,
  KPIIconProps,
  KPIProgressProps,
  KPIRootProps as KPIProps,
  KPIRootProps,
  KPISeparatorProps,
  KPITitleProps,
  KPITrendProps,
  KPIValueProps,
} from './kpi';
export type { KPIVariants } from './kpi.styles';

export type KPI = {
  ActionsProps: ComponentProps<typeof KPIActions>;
  ChartProps: ComponentProps<typeof KPIChart>;
  ContentProps: ComponentProps<typeof KPIContent>;
  FooterProps: ComponentProps<typeof KPIFooter>;
  HeaderProps: ComponentProps<typeof KPIHeader>;
  IconProps: ComponentProps<typeof KPIIcon>;
  ProgressProps: ComponentProps<typeof KPIProgress>;
  Props: ComponentProps<typeof KPIRoot>;
  RootProps: ComponentProps<typeof KPIRoot>;
  SeparatorProps: ComponentProps<typeof KPISeparator>;
  TitleProps: ComponentProps<typeof KPITitle>;
  TrendProps: ComponentProps<typeof KPITrend>;
  ValueProps: ComponentProps<typeof KPIValue>;
};
