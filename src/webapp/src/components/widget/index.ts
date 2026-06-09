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
