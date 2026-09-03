'use client';

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { jsx } from 'react/jsx-runtime';

export type HoldConfirmSweep = 'down' | 'left' | 'right' | 'up';

export interface HoldConfirmProps {
  children?: ReactNode;
  className?: string;
  /** Hold duration in ms. @default 2000 */
  duration?: number;
  isDisabled?: boolean;
  onComplete?: () => void;
  /** Duration for snap-back animation on release. @default 200 */
  releaseDuration?: number;
  /** Whether to reset after completion. @default true */
  resetOnComplete?: boolean;
  sweep?: HoldConfirmSweep;
  style?: CSSProperties;
}

export const HoldConfirm = ({
  children,
  className = '',
  duration = 2000,
  isDisabled = false,
  onComplete,
  releaseDuration = 200,
  resetOnComplete = true,
  style,
  sweep = 'right',
}: HoldConfirmProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isHolding, setIsHolding] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const isParentDisabled = useCallback(() => {
    const parent = ref.current?.parentElement as HTMLButtonElement | null;
    return parent?.disabled || parent?.getAttribute('aria-disabled') === 'true';
  }, []);

  const isFromChildInteractive = useCallback((e: Event) => {
    const parent = ref.current?.parentElement;
    const target = e.target as Element | null;
    if (!parent || !target || target === parent) return false;
    const closest = target.closest(
      "a,button,input,select,textarea,[role='button']"
    );
    return !!closest && closest !== parent && parent.contains(closest);
  }, []);

  const startHold = useCallback(
    (e: Event) => {
      if (isDisabled || isParentDisabled()) return;
      if (e instanceof PointerEvent) {
        if (!e.isPrimary || isFromChildInteractive(e)) return;
      } else if (e instanceof KeyboardEvent) {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        if (e.repeat) return;
      }
      setIsHolding(true);
      setIsComplete(false);
      timerRef.current = setTimeout(() => {
        setIsComplete(true);
        onCompleteRef.current?.();
        if (resetOnComplete) {
          setIsComplete(false);
          setIsHolding(false);
        }
      }, duration);
    },
    [
      duration,
      resetOnComplete,
      isDisabled,
      isParentDisabled,
      isFromChildInteractive,
    ]
  );

  const cancelHold = useCallback(() => {
    clearTimeout(timerRef.current);
    setIsHolding(false);
  }, []);

  const handleKeyUp = useCallback(
    (e: Event) => {
      if (e instanceof KeyboardEvent && (e.key === ' ' || e.key === 'Enter')) {
        cancelHold();
      }
    },
    [cancelHold]
  );

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;

    const add = (type: string, handler: EventListener) =>
      parent.addEventListener(type, handler, true);

    add('pointerdown', startHold);
    add('pointerup', cancelHold);
    add('pointerleave', cancelHold);
    add('pointercancel', cancelHold);
    add('keydown', startHold);
    add('keyup', handleKeyUp);
    add('blur', cancelHold);

    return () => {
      const remove = (type: string, handler: EventListener) =>
        parent.removeEventListener(type, handler, true);
      remove('pointerdown', startHold);
      remove('pointerup', cancelHold);
      remove('pointerleave', cancelHold);
      remove('pointercancel', cancelHold);
      remove('keydown', startHold);
      remove('keyup', handleKeyUp);
      remove('blur', cancelHold);
    };
  }, [startHold, handleKeyUp, cancelHold]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return jsx('div', {
    ref,
    'aria-hidden': 'true',
    className:
      'pressable-feedback__hold-confirm' + (className ? ` ${className}` : ''),
    'data-complete': isComplete || undefined,
    'data-holding': isHolding || undefined,
    'data-slot': 'pressable-feedback-hold-confirm',
    'data-sweep': sweep,
    style: {
      '--pressable-feedback-hold-confirm-duration': `${duration}ms`,
      '--pressable-feedback-hold-confirm-release-duration': `${releaseDuration}ms`,
      ...style,
    } as CSSProperties,
    children,
  });
};
