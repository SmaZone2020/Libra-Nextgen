'use client';

import type { ComponentPropsWithRef } from 'react';
import React, {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';
import { composeSlotClassName } from '../../utils/compose';
import type { StepperVariants } from './stepper.styles';
import { stepperVariants } from './stepper.styles';

type StepStatus = 'inactive' | 'active' | 'complete';

type StepperContextValue = {
  currentStep: number;
  onStepChange?: (step: number) => void;
  slots: ReturnType<typeof stepperVariants>;
};

type StepperStepContextValue = {
  index: number;
  isLast: boolean;
  status: StepStatus;
};

const StepperContext = createContext<StepperContextValue>({
  currentStep: 0,
  slots: {} as ReturnType<typeof stepperVariants>,
});
const StepperStepContext = createContext<StepperStepContextValue>({
  index: 0,
  isLast: false,
  status: 'inactive',
});

/**
 * Hook to access per-step context (index, status, isLast) from any descendant
 * of `<Stepper.Step>`.
 */
const useStepperStep = () => useContext(StepperStepContext);

interface StepperRootProps extends Omit<
  ComponentPropsWithRef<'ol'>,
  'children'
> {
  children: ReactNode;
  currentStep?: number;
  defaultStep?: number;
  onStepChange?: (step: number) => void;
  orientation?: StepperVariants['orientation'];
  size?: StepperVariants['size'];
}

type StepperStepInternalProps = {
  _index: number;
  _isLast: boolean;
};

const StepperRoot = ({
  children,
  className,
  currentStep: currentStepProp,
  defaultStep = 0,
  onStepChange,
  orientation = 'horizontal',
  size = 'md',
  ...props
}: StepperRootProps) => {
  const [internalStep, setInternalStep] = useState(defaultStep);
  const currentStep = currentStepProp ?? internalStep;
  const slots = useMemo(
    () => stepperVariants({ orientation, size }),
    [orientation, size]
  );

  const childArray = React.Children.toArray(children);
  let stepCount = 0;
  childArray.forEach((child) => {
    if (React.isValidElement(child) && child.type === StepperStep) stepCount++;
  });

  let stepIndex = 0;
  const clonedChildren = childArray.map((child) => {
    if (React.isValidElement(child) && child.type === StepperStep) {
      const idx = stepIndex++;
      return React.cloneElement(
        child as React.ReactElement<
          StepperStepProps & Partial<StepperStepInternalProps>
        >,
        {
          _index: idx,
          _isLast: idx === stepCount - 1,
          key: (child as React.ReactElement).key ?? `step-${idx}`,
        }
      );
    }
    return child;
  });

  return (
    <StepperContext.Provider
      value={{
        currentStep,
        onStepChange: onStepChange
          ? (step) => {
              if (currentStepProp === undefined) setInternalStep(step);
              onStepChange?.(step);
            }
          : undefined,
        slots,
      }}
    >
      <ol
        aria-label="Progress"
        className={composeSlotClassName(slots?.base, className)}
        data-slot="stepper"
        {...props}
      >
        {clonedChildren}
      </ol>
    </StepperContext.Provider>
  );
};

interface StepperIndicatorProps {
  children?: ReactNode;
  className?: string;
}

const StepperIndicator = ({
  children,
  className,
  ...props
}: StepperIndicatorProps & ComponentPropsWithRef<'span'>) => {
  const { slots } = useContext(StepperContext);
  const { index, status } = useContext(StepperStepContext);
  const defaultContent =
    status === 'complete' ? (
      <StepperIcon>
        <svg
          aria-hidden="true"
          data-slot="stepper-default-checkmark"
          fill="none"
          role="presentation"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
          viewBox="0 0 17 18"
        >
          <polyline points="1 9 7 14 15 4" />
        </svg>
      </StepperIcon>
    ) : (
      <span>{index + 1}</span>
    );

  return (
    <span
      className={composeSlotClassName(slots?.indicator, className)}
      data-slot="stepper-indicator"
      data-status={status}
      {...props}
    >
      {children ?? defaultContent}
    </span>
  );
};

interface StepperContentProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const StepperContent = ({
  children,
  className,
  ...props
}: StepperContentProps) => {
  const { slots } = useContext(StepperContext);
  return (
    <span
      className={composeSlotClassName(slots?.content, className)}
      data-slot="stepper-content"
      {...props}
    >
      {children}
    </span>
  );
};

interface StepperTitleProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const StepperTitle = ({ children, className, ...props }: StepperTitleProps) => {
  const { slots } = useContext(StepperContext);
  return (
    <span
      className={composeSlotClassName(slots?.title, className)}
      data-slot="stepper-title"
      {...props}
    >
      {children}
    </span>
  );
};

interface StepperDescriptionProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const StepperDescription = ({
  children,
  className,
  ...props
}: StepperDescriptionProps) => {
  const { slots } = useContext(StepperContext);
  return (
    <span
      className={composeSlotClassName(slots?.description, className)}
      data-slot="stepper-description"
      {...props}
    >
      {children}
    </span>
  );
};

interface StepperIconProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const StepperIcon = ({ children, className, ...props }: StepperIconProps) => {
  const { slots } = useContext(StepperContext);
  return (
    <span
      className={composeSlotClassName(slots?.icon, className)}
      data-slot="stepper-icon"
      {...props}
    >
      {children}
    </span>
  );
};

interface StepperSeparatorProps extends ComponentPropsWithRef<'div'> {
  force?: boolean;
  progress?: number;
}

const StepperSeparator = ({
  className,
  force,
  progress: progressProp,
  ...props
}: StepperSeparatorProps) => {
  const { currentStep, slots } = useContext(StepperContext);
  const { index, isLast } = useContext(StepperStepContext);

  if (isLast && !force) return null;

  const currentFloor = Math.floor(currentStep);
  const progress = Math.min(
    1,
    Math.max(
      0,
      progressProp ??
        (currentFloor > index
          ? 1
          : currentFloor === index
            ? currentStep - currentFloor
            : 0)
    )
  );

  return (
    <div
      aria-hidden="true"
      className={composeSlotClassName(slots?.separator, className)}
      data-slot="stepper-separator"
      {...props}
    >
      <div
        className={slots?.separatorTrack()}
        data-complete={progress >= 1 || undefined}
        data-slot="stepper-separator-track"
      >
        <div
          className={slots?.separatorFill()}
          data-slot="stepper-separator-fill"
          style={
            { '--stepper-separator-progress': progress } as React.CSSProperties
          }
        />
      </div>
    </div>
  );
};

interface StepperStepProps extends Omit<
  ComponentPropsWithRef<'li'>,
  'children'
> {
  children?: ReactNode;
}

const StepperStep = ({
  _index: injectedIndex,
  _isLast: injectedIsLast,
  children,
  className,
  ...restProps
}: StepperStepProps & Partial<StepperStepInternalProps>) => {
  const { currentStep, onStepChange, slots } = useContext(StepperContext);
  const index = injectedIndex ?? 0;
  const isLast = injectedIsLast ?? false;
  const currentFloor = Math.floor(currentStep);
  const status: StepStatus =
    currentFloor === index
      ? 'active'
      : currentFloor > index
        ? 'complete'
        : 'inactive';

  const ctxValue = useMemo(
    () => ({ index, isLast, status }),
    [index, isLast, status]
  );

  const regularChildren: ReactNode[] = [];
  let separator: React.ReactElement | null = null;

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === StepperSeparator) {
      separator = child as React.ReactElement;
    } else {
      regularChildren.push(child);
    }
  });

  return (
    <StepperStepContext.Provider value={ctxValue}>
      <li
        className={composeSlotClassName(slots?.step, className)}
        data-index={index}
        data-slot="stepper-step"
        data-status={status}
        {...restProps}
      >
        <button
          aria-current={status === 'active' ? 'step' : undefined}
          className={slots?.stepButton()}
          data-clickable={!!onStepChange || undefined}
          data-slot="stepper-step-button"
          tabIndex={onStepChange ? undefined : -1}
          type="button"
          onClick={onStepChange ? () => onStepChange(index) : undefined}
        >
          {regularChildren}
        </button>
        {separator}
      </li>
    </StepperStepContext.Provider>
  );
};

export {
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
  StepperRootProps,
  StepperSeparatorProps,
  StepperStepProps,
  StepperTitleProps,
  StepStatus,
};
