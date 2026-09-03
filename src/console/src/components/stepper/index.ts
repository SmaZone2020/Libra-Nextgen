import type { ComponentProps } from 'react';
import {
  StepperContent,
  StepperDescription,
  StepperIcon,
  StepperIndicator,
  StepperRoot,
  StepperSeparator,
  StepperStep,
  StepperStepButton,
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
  StepButton: StepperStepButton,
  Title: StepperTitle,
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
  StepperStepButton,
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
  StepperStepButtonProps,
  StepperStepProps,
  StepperTitleProps,
} from './stepper';
export type { StepperStepStatus } from './stepper';
export type { StepperVariants } from './stepper.styles';

export type Stepper = {
  ContentProps: ComponentProps<typeof StepperContent>;
  DescriptionProps: ComponentProps<typeof StepperDescription>;
  IconProps: ComponentProps<typeof StepperIcon>;
  IndicatorProps: ComponentProps<typeof StepperIndicator>;
  RootProps: ComponentProps<typeof StepperRoot>;
  SeparatorProps: ComponentProps<typeof StepperSeparator>;
  StepButtonProps: ComponentProps<typeof StepperStepButton>;
  StepProps: ComponentProps<typeof StepperStep>;
  TitleProps: ComponentProps<typeof StepperTitle>;
};
