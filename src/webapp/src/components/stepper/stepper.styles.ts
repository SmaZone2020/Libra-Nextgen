import { tv, type VariantProps } from 'tailwind-variants';

const stepperVariants = tv({
  defaultVariants: {
    orientation: 'horizontal',
    size: 'md',
  },
  slots: {
    base: 'stepper',
    content: 'stepper__content',
    description: 'stepper__description',
    icon: 'stepper__icon',
    indicator: 'stepper__indicator',
    separator: 'stepper__separator',
    separatorFill: 'stepper__separator-fill',
    separatorTrack: 'stepper__separator-track',
    step: 'stepper__step',
    stepButton: 'stepper__step-button',
    title: 'stepper__title',
  },
  variants: {
    orientation: {
      horizontal: {
        base: 'stepper--horizontal',
        content: 'stepper__content--horizontal',
        separator: 'stepper__separator--horizontal',
        separatorFill: 'stepper__separator-fill--horizontal',
        separatorTrack: 'stepper__separator-track--horizontal',
        step: 'stepper__step--horizontal',
        stepButton: 'stepper__step-button--horizontal',
      },
      vertical: {
        base: 'stepper--vertical',
        content: 'stepper__content--vertical',
        separator: 'stepper__separator--vertical',
        separatorFill: 'stepper__separator-fill--vertical',
        separatorTrack: 'stepper__separator-track--vertical',
        step: 'stepper__step--vertical',
        stepButton: 'stepper__step-button--vertical',
      },
    },
    size: {
      lg: {
        base: 'stepper--lg',
        description: 'stepper__description--lg',
        indicator: 'stepper__indicator--lg',
        title: 'stepper__title--lg',
      },
      md: {
        base: 'stepper--md',
        description: 'stepper__description--md',
        indicator: 'stepper__indicator--md',
        title: 'stepper__title--md',
      },
      sm: {
        base: 'stepper--sm',
        description: 'stepper__description--sm',
        indicator: 'stepper__indicator--sm',
        title: 'stepper__title--sm',
      },
    },
  },
});

export type StepperVariants = VariantProps<typeof stepperVariants>;
export { stepperVariants };
