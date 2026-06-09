import {
  InlineSelectIndicator,
  InlineSelectPopover,
  InlineSelectRoot,
  InlineSelectTrigger,
  InlineSelectValue,
} from './inline-select';

export { inlineSelectVariants } from './inline-select.styles';

export const InlineSelect = Object.assign(InlineSelectRoot, {
  Indicator: InlineSelectIndicator,
  Popover: InlineSelectPopover,
  Root: InlineSelectRoot,
  Trigger: InlineSelectTrigger,
  Value: InlineSelectValue,
});

export {
  InlineSelectIndicator,
  InlineSelectPopover,
  InlineSelectRoot,
  InlineSelectTrigger,
  InlineSelectValue,
};

export type {
  InlineSelectIndicatorProps,
  InlineSelectPopoverProps,
  InlineSelectRootProps as InlineSelectProps,
  InlineSelectRootProps,
  InlineSelectTriggerProps,
  InlineSelectValueProps,
} from './inline-select';
export type { InlineSelectVariants } from './inline-select.styles';
export { inlineSelectVariants as default } from './inline-select.styles';
