'use client';

import {
  type ComponentPropsWithRef,
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';
import { jsx } from 'react/jsx-runtime';
import type { DOMRenderProps } from '@heroui/react';
import { dom } from '@heroui/react';
import { dataAttr } from '../../utils/assertion';
import { composeSlotClassName } from '../../utils/compose';
import type { HoldConfirmProps } from './hold-confirm';
import { HoldConfirm } from './hold-confirm';
import { pressableFeedbackVariants } from './pressable-feedback.styles';
import type { ProgressFeedbackProps } from './progress-feedback';
import { ProgressFeedback } from './progress-feedback';
import type { RippleProps } from './ripple';
import { Ripple } from './ripple';

type PressableFeedbackContextValue = {
  slots?: ReturnType<typeof pressableFeedbackVariants>;
};

const PressableFeedbackContext = createContext<PressableFeedbackContextValue>(
  {}
);

const defaultSlots = pressableFeedbackVariants();

export interface PressableFeedbackRootProps<
  E extends keyof React.JSX.IntrinsicElements = 'button',
> extends DOMRenderProps<E, undefined> {
  children: ReactNode;
  className?: string;
  isDisabled?: boolean;
}

export const PressableFeedbackRoot = <
  E extends keyof React.JSX.IntrinsicElements = 'button',
>({
  children,
  className,
  isDisabled,
  ...props
}: PressableFeedbackRootProps<E> &
  Omit<
    React.JSX.IntrinsicElements[E],
    keyof PressableFeedbackRootProps<E>
  >) => {
  const slots = useMemo(() => pressableFeedbackVariants(), []);
  return jsx(PressableFeedbackContext, {
    value: { slots },
    children: jsx(dom.button, {
      'aria-disabled': isDisabled || undefined,
      className: composeSlotClassName(slots?.base, className),
      'data-slot': 'pressable-feedback',
      disabled: dataAttr(isDisabled || undefined),
      type: 'button',
      ...(props as object),
      children,
    }),
  });
};

export interface PressableFeedbackHighlightProps extends ComponentPropsWithRef<'div'> {}

export const PressableFeedbackHighlight = ({
  className,
  ...props
}: PressableFeedbackHighlightProps) => {
  const { slots = defaultSlots } = useContext(PressableFeedbackContext);
  return jsx('div', {
    'aria-hidden': 'true',
    className: composeSlotClassName(slots?.highlight, className),
    'data-slot': 'pressable-feedback-highlight',
    ...props,
  });
};

export interface PressableFeedbackRippleProps extends RippleProps {}

export const PressableFeedbackRipple = ({
  className,
  ...props
}: PressableFeedbackRippleProps) => {
  return jsx(Ripple, {
    className,
    'data-slot': 'pressable-feedback-ripple',
    ...props,
  });
};

export interface PressableFeedbackHoldConfirmProps extends HoldConfirmProps {}

export const PressableFeedbackHoldConfirm = ({
  className,
  ...props
}: PressableFeedbackHoldConfirmProps) => {
  return jsx(HoldConfirm, { className, ...props });
};

export interface PressableFeedbackProgressFeedbackProps extends ProgressFeedbackProps {}

export const PressableFeedbackProgressFeedback = ({
  className,
  ...props
}: PressableFeedbackProgressFeedbackProps) => {
  return jsx(ProgressFeedback, { className, ...props });
};
