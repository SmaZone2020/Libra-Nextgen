import type { ComponentProps } from 'react';
import {
  CheckboxButtonGroupIndicator,
  CheckboxButtonGroupItem,
  CheckboxButtonGroupItemContent,
  CheckboxButtonGroupItemIcon,
  CheckboxButtonGroupRoot,
} from './checkbox-button-group';

export const CheckboxButtonGroup = Object.assign(CheckboxButtonGroupRoot, {
  Indicator: CheckboxButtonGroupIndicator,
  Item: CheckboxButtonGroupItem,
  ItemContent: CheckboxButtonGroupItemContent,
  ItemIcon: CheckboxButtonGroupItemIcon,
  Root: CheckboxButtonGroupRoot,
});

export type CheckboxButtonGroup = {
  IndicatorProps: ComponentProps<typeof CheckboxButtonGroupIndicator>;
  ItemContentProps: ComponentProps<typeof CheckboxButtonGroupItemContent>;
  ItemIconProps: ComponentProps<typeof CheckboxButtonGroupItemIcon>;
  ItemProps: ComponentProps<typeof CheckboxButtonGroupItem>;
  Props: ComponentProps<typeof CheckboxButtonGroupRoot>;
  RootProps: ComponentProps<typeof CheckboxButtonGroupRoot>;
};

export {
  CheckboxButtonGroupIndicator,
  CheckboxButtonGroupItem,
  CheckboxButtonGroupItemContent,
  CheckboxButtonGroupItemIcon,
  CheckboxButtonGroupRoot,
};
export type {
  CheckboxButtonGroupIndicatorProps,
  CheckboxButtonGroupItemContentProps,
  CheckboxButtonGroupItemIconProps,
  CheckboxButtonGroupItemProps,
  CheckboxButtonGroupRootProps as CheckboxButtonGroupProps,
  CheckboxButtonGroupRootProps,
} from './checkbox-button-group';
export type { CheckboxButtonGroupVariants } from './checkbox-button-group.styles';
export { checkboxButtonGroupVariants } from './checkbox-button-group.styles';
