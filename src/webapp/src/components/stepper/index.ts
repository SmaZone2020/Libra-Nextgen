import {
  StepperContent,
  StepperDescription,
  StepperIcon,
  StepperIndicator,
  StepperRoot,
  StepperSeparator,
  StepperStep,
  StepperTitle,
  useStepperStep,
} from './stepper';
export { stepperVariants } from './stepper.styles';

const Stepper = Object.assign(StepperRoot, {
  Content: StepperContent,
  Description: StepperDescription,
  Icon: StepperIcon,
  Indicator: StepperIndicator,
  Root: StepperRoot,
  Separator: StepperSeparator,
  Step: StepperStep,
  Title: StepperTitle,
  useStep: useStepperStep,
});

export {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIcon,
  StepperIndicator,
  StepperRoot,
  StepperSeparator,
  StepperStep,
  StepperTitle,
  useStepperStep,
};

export type {
  StepperContentProps,
  StepperDescriptionProps,
  StepperIconProps,
  StepperIndicatorProps,
  StepperRootProps as StepperProps,
  StepperRootProps,
  StepperSeparatorProps,
  StepperStepProps,
  StepperTitleProps,
  StepStatus,
} from './stepper';
export type { StepperVariants } from './stepper.styles';
