import type { ComponentProps } from 'react';
import {
  WidgetContent,
  WidgetDescription,
  WidgetFooter,
  WidgetHeader,
  WidgetLegend,
  WidgetLegendItem,
  WidgetRoot,
  WidgetTitle,
} from './widget';
export { widgetVariants } from './widget.styles';

const Widget = Object.assign(WidgetRoot, {
  Content: WidgetContent,
  Description: WidgetDescription,
  Footer: WidgetFooter,
  Header: WidgetHeader,
  Legend: WidgetLegend,
  LegendItem: WidgetLegendItem,
  Root: WidgetRoot,
  Title: WidgetTitle,
});

export {
  Widget,
  WidgetContent,
  WidgetDescription,
  WidgetFooter,
  WidgetHeader,
  WidgetLegend,
  WidgetLegendItem,
  WidgetRoot,
  WidgetTitle,
};

export type {
  WidgetContentProps,
  WidgetDescriptionProps,
  WidgetFooterProps,
  WidgetHeaderProps,
  WidgetLegendItemProps,
  WidgetLegendProps,
  WidgetRootProps as WidgetProps,
  WidgetRootProps,
  WidgetTitleProps,
} from './widget';

/** 复合类型：经 `Widget.Props` 等引用各子组件的 props（与 ui-pro 源对齐）。 */
export type Widget = {
  ContentProps: ComponentProps<typeof WidgetContent>;
  DescriptionProps: ComponentProps<typeof WidgetDescription>;
  FooterProps: ComponentProps<typeof WidgetFooter>;
  HeaderProps: ComponentProps<typeof WidgetHeader>;
  LegendItemProps: ComponentProps<typeof WidgetLegendItem>;
  LegendProps: ComponentProps<typeof WidgetLegend>;
  Props: ComponentProps<typeof WidgetRoot>;
  RootProps: ComponentProps<typeof WidgetRoot>;
  TitleProps: ComponentProps<typeof WidgetTitle>;
};
