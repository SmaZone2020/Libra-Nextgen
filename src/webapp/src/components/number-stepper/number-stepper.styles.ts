import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const numberStepperVariants = tv({
  defaultVariants: {
    size: 'md',
  },
  slots: {
    base: 'number-stepper',
    decrementButton: 'number-stepper__decrement-button',
    group: 'number-stepper__group',
    incrementButton: 'number-stepper__increment-button',
    input: 'number-stepper__input',
    value: 'number-stepper__value',
  },
  variants: {
    size: {
      lg: {
        decrementButton: 'number-stepper__decrement-button--lg',
        group: 'number-stepper__group--lg',
        incrementButton: 'number-stepper__increment-button--lg',
        value: 'number-stepper__value--lg',
      },
      md: {
        decrementButton: 'number-stepper__decrement-button--md',
        group: 'number-stepper__group--md',
        incrementButton: 'number-stepper__increment-button--md',
        value: 'number-stepper__value--md',
      },
      sm: {
        decrementButton: 'number-stepper__decrement-button--sm',
        group: 'number-stepper__group--sm',
        incrementButton: 'number-stepper__increment-button--sm',
        value: 'number-stepper__value--sm',
      },
    },
  },
});

export type NumberStepperVariants = VariantProps<typeof numberStepperVariants>;
