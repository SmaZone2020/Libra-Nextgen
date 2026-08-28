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

export type ProgressFeedbackSweep = 'down' | 'left' | 'right' | 'up';

export interface ProgressFeedbackProps {
  /** Whether to automatically reset after completing. @default true */
  autoReset?: boolean;
  children?: ReactNode;
  className?: string;
  /** Progress duration in ms. @default 2000 */
  duration?: number;
  isDisabled?: boolean;
  onComplete?: () => void;
  onReset?: () => void;
  /** Duration for snap-back animation on reset. @default 300 */
  releaseDuration?: number;
  /** Delay in ms before resetting after completion. @default 1500 */
  resetDelay?: number;
  style?: CSSProperties;
  /** @default "right" */
  sweep?: ProgressFeedbackSweep;
}

type State = 'idle' | 'progressing' | 'complete';

export const ProgressFeedback = ({
  autoReset = true,
  children,
  className = '',
  duration = 2000,
  isDisabled = false,
  onComplete,
  onReset,
  releaseDuration = 300,
  resetDelay = 1500,
  style,
  sweep = 'right',
}: ProgressFeedbackProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isProgressing, setIsProgressing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const stateRef = useRef<State>('idle');
  const onCompleteRef = useRef(onComplete);
  const onResetRef = useRef(onReset);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    onResetRef.current = onReset;
  }, [onReset]);

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

  const startProgress = useCallback(
    (e: Event) => {
      if (isDisabled || isParentDisabled() || isFromChildInteractive(e)) return;
      if (stateRef.current !== 'idle') return;

      stateRef.current = 'progressing';
      setIsProgressing(true);
      setIsComplete(false);

      timerRef.current = setTimeout(() => {
        stateRef.current = 'complete';
        setIsProgressing(false);
        setIsComplete(true);
        onCompleteRef.current?.();

        if (autoReset) {
          resetTimerRef.current = setTimeout(() => {
            stateRef.current = 'idle';
            setIsComplete(false);
            onResetRef.current?.();
          }, resetDelay);
        }
      }, duration);
    },
    [
      isDisabled,
      isParentDisabled,
      isFromChildInteractive,
      duration,
      autoReset,
      resetDelay,
    ]
  );

  const handleClick = useCallback(
    (e: Event) => {
      startProgress(e);
    },
    [startProgress]
  );

  const handleKeyDown = useCallback(
    (e: Event) => {
      if (
        e instanceof KeyboardEvent &&
        (e.key === ' ' || e.key === 'Enter') &&
        !e.repeat
      ) {
        startProgress(e);
        (e as KeyboardEvent).preventDefault();
      }
    },
    [startProgress]
  );

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    parent.addEventListener('click', handleClick, true);
    parent.addEventListener('keydown', handleKeyDown, true);
    return () => {
      parent.removeEventListener('click', handleClick, true);
      parent.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleClick, handleKeyDown]);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      clearTimeout(resetTimerRef.current);
    },
    []
  );

  return jsx('div', {
    ref,
    'aria-hidden': 'true',
    className:
      'pressable-feedback__progress-feedback' +
      (className ? ` ${className}` : ''),
    'data-complete': isComplete || undefined,
    'data-progressing': isProgressing || undefined,
    'data-slot': 'pressable-feedback-progress-feedback',
    'data-sweep': sweep,
    style: {
      '--pressable-feedback-progress-feedback-duration': `${duration}ms`,
      '--pressable-feedback-progress-feedback-release-duration': `${releaseDuration}ms`,
      ...style,
    } as CSSProperties,
    children,
  });
};
