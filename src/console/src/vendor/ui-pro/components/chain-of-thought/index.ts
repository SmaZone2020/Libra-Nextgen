import type { ComponentProps } from 'react';
import {
  ChainOfThoughtContent,
  ChainOfThoughtRoot,
  ChainOfThoughtStep,
  ChainOfThoughtSteps,
  ChainOfThoughtTrigger,
} from './chain-of-thought';

export const ChainOfThought = Object.assign(ChainOfThoughtRoot, {
  Content: ChainOfThoughtContent,
  Root: ChainOfThoughtRoot,
  Step: ChainOfThoughtStep,
  Steps: ChainOfThoughtSteps,
  Trigger: ChainOfThoughtTrigger,
});

export type ChainOfThought = {
  ContentProps: ComponentProps<typeof ChainOfThoughtContent>;
  Props: ComponentProps<typeof ChainOfThoughtRoot>;
  RootProps: ComponentProps<typeof ChainOfThoughtRoot>;
  StepProps: ComponentProps<typeof ChainOfThoughtStep>;
  StepsProps: ComponentProps<typeof ChainOfThoughtSteps>;
  TriggerProps: ComponentProps<typeof ChainOfThoughtTrigger>;
};

export {
  ChainOfThoughtContent,
  ChainOfThoughtRoot,
  ChainOfThoughtStep,
  ChainOfThoughtSteps,
  ChainOfThoughtTrigger,
};
export type {
  ChainOfThoughtContentProps,
  ChainOfThoughtProps,
  ChainOfThoughtRootProps,
  ChainOfThoughtStepProps,
  ChainOfThoughtStepsProps,
  ChainOfThoughtTriggerProps,
} from './chain-of-thought';
export type { ChainOfThoughtVariants } from './chain-of-thought.styles';
export { chainOfThoughtVariants } from './chain-of-thought.styles';
