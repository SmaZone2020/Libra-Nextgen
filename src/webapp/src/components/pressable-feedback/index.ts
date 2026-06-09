import {
  PressableFeedbackHighlight,
  PressableFeedbackHoldConfirm,
  PressableFeedbackProgressFeedback,
  PressableFeedbackRipple,
  PressableFeedbackRoot,
} from './pressable-feedback';

export { pressableFeedbackVariants } from './pressable-feedback.styles';

const PressableFeedback = Object.assign(PressableFeedbackRoot, {
  Highlight: PressableFeedbackHighlight,
  HoldConfirm: PressableFeedbackHoldConfirm,
  ProgressFeedback: PressableFeedbackProgressFeedback,
  Ripple: PressableFeedbackRipple,
  Root: PressableFeedbackRoot,
});

export {
  PressableFeedback,
  PressableFeedbackHighlight,
  PressableFeedbackHoldConfirm,
  PressableFeedbackProgressFeedback,
  PressableFeedbackRipple,
  PressableFeedbackRoot,
};

export type {
  PressableFeedbackHighlightProps,
  PressableFeedbackHoldConfirmProps,
  PressableFeedbackProgressFeedbackProps,
  PressableFeedbackRootProps as PressableFeedbackProps,
  PressableFeedbackRippleProps,
  PressableFeedbackRootProps,
} from './pressable-feedback';
