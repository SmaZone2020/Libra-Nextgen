import { tv } from 'tailwind-variants';

export const pressableFeedbackVariants = tv({
  slots: {
    base: 'pressable-feedback',
    highlight: 'pressable-feedback__highlight',
    holdConfirm: 'pressable-feedback__hold-confirm',
    progressFeedback: 'pressable-feedback__progress-feedback',
    ripple: 'pressable-feedback__ripple',
  },
});
