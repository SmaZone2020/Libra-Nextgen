import {
  NumberStepperDecrementButton,
  NumberStepperGroup,
  NumberStepperIncrementButton,
  NumberStepperRoot,
  NumberStepperValue,
} from './number-stepper';

export { numberStepperVariants } from './number-stepper.styles';

const NumberStepper = Object.assign(NumberStepperRoot, {
  DecrementButton: NumberStepperDecrementButton,
  Group: NumberStepperGroup,
  IncrementButton: NumberStepperIncrementButton,
  Root: NumberStepperRoot,
  Value: NumberStepperValue,
});

export {
  NumberStepper,
  NumberStepperDecrementButton,
  NumberStepperGroup,
  NumberStepperIncrementButton,
  NumberStepperRoot,
  NumberStepperValue,
};

export type {
  NumberStepperDecrementButtonProps,
  NumberStepperGroupProps,
  NumberStepperIncrementButtonProps,
  NumberStepperRootProps as NumberStepperProps,
  NumberStepperRootProps,
  NumberStepperValueProps,
  NumberStepperValueRenderProps,
} from './number-stepper';
export type { NumberStepperVariants } from './number-stepper.styles';
export { numberStepperVariants as numberStepperVariantsFromStyles } from './number-stepper.styles';
