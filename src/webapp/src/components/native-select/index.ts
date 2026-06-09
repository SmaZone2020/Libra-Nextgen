import type { ComponentProps } from 'react';
import {
  NativeSelectIndicator,
  NativeSelectOptGroup,
  NativeSelectOption,
  NativeSelectRoot,
  NativeSelectTrigger,
} from './native-select';

export { nativeSelectVariants } from './native-select.styles';

const NativeSelect = Object.assign(NativeSelectRoot, {
  Indicator: NativeSelectIndicator,
  OptGroup: NativeSelectOptGroup,
  Option: NativeSelectOption,
  Root: NativeSelectRoot,
  Trigger: NativeSelectTrigger,
});

export {
  NativeSelect,
  NativeSelectIndicator,
  NativeSelectOptGroup,
  NativeSelectOption,
  NativeSelectRoot,
  NativeSelectTrigger,
};

export type {
  NativeSelectIndicatorProps,
  NativeSelectOptGroupProps,
  NativeSelectOptionProps,
  NativeSelectRootProps as NativeSelectProps,
  NativeSelectRootProps,
  NativeSelectTriggerProps,
} from './native-select';
export type { NativeSelectVariants } from './native-select.styles';

export type NativeSelect = {
  IndicatorProps: ComponentProps<typeof NativeSelectIndicator>;
  OptGroupProps: ComponentProps<typeof NativeSelectOptGroup>;
  OptionProps: ComponentProps<typeof NativeSelectOption>;
  Props: ComponentProps<typeof NativeSelectRoot>;
  RootProps: ComponentProps<typeof NativeSelectRoot>;
  TriggerProps: ComponentProps<typeof NativeSelectTrigger>;
};
