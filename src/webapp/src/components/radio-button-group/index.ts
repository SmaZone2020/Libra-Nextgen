import {
  RadioButtonGroupIndicator,
  RadioButtonGroupItem,
  RadioButtonGroupItemContent,
  RadioButtonGroupItemIcon,
  RadioButtonGroupRoot,
} from './radio-button-group';
export { radioButtonGroupVariants } from './radio-button-group.styles';

const RadioButtonGroup = Object.assign(RadioButtonGroupRoot, {
  Indicator: RadioButtonGroupIndicator,
  Item: RadioButtonGroupItem,
  ItemContent: RadioButtonGroupItemContent,
  ItemIcon: RadioButtonGroupItemIcon,
  Root: RadioButtonGroupRoot,
});

export {
  RadioButtonGroup,
  RadioButtonGroupIndicator,
  RadioButtonGroupItem,
  RadioButtonGroupItemContent,
  RadioButtonGroupItemIcon,
  RadioButtonGroupRoot,
};

export type {
  RadioButtonGroupIndicatorProps,
  RadioButtonGroupItemContentProps,
  RadioButtonGroupItemIconProps,
  RadioButtonGroupItemProps,
  RadioButtonGroupRootProps as RadioButtonGroupProps,
  RadioButtonGroupRootProps,
} from './radio-button-group';
export type { RadioButtonGroupVariants } from './radio-button-group.styles';
