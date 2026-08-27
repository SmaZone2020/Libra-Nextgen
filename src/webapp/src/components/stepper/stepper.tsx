'use client';

import type { ComponentPropsWithRef, ReactNode, SVGProps } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { composeSlotClassName, composeTwRenderProps } from '../../utils/compose';
import type { StepperVariants } from './stepper.styles';
import { stepperVariants } from './stepper.styles';

interface StepperContextValue {
  slots?: ReturnType<typeof stepperVariants>;
  orientation?: StepperVariants['orientation'];
  size?: StepperVariants['size'];
}

const StepperContext = createContext<StepperContextValue>({});

/** 步骤状态：inactive / active / complete（与 stepper.css 的 data-status 对齐）。 */
export type StepperStepStatus = 'inactive' | 'active' | 'complete';

const DEFAULT_CHECKMARK = (props: SVGProps<SVGSVGElement>) => (
  <svg
    data-slot="stepper-default-checkmark"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
  </svg>
);

/* -------------------------------------------------------------------------------------------------
 * Stepper Root
 * -----------------------------------------------------------------------------------------------*/

interface StepperRootProps extends ComponentPropsWithRef<'ol'> {
  children: ReactNode;
  /** Layout direction. @default "horizontal" */
  orientation?: StepperVariants['orientation'];
  /** Indicator size. @default "md" */
  size?: StepperVariants['size'];
}

const StepperRoot = ({
  children,
  className,
  orientation = 'horizontal',
  size = 'md',
  ...props
}: StepperRootProps) => {
  const slots = useMemo(() => stepperVariants({ orientation, size }), [orientation, size]);

  return (
    <StepperContext.Provider value={{ slots, orientation, size }}>
      <ol
        className={composeSlotClassName(slots?.base, className)}
        data-orientation={orientation}
        data-slot="stepper"
        {...props}
      >
        {children}
      </ol>
    </StepperContext.Provider>
  );
};

/* -------------------------------------------------------------------------------------------------
 * Stepper Step
 * -----------------------------------------------------------------------------------------------*/

interface StepperStepProps extends ComponentPropsWithRef<'li'> {
  children: ReactNode;
  /** Visual state of this step. @default "inactive" */
  status?: StepperStepStatus;
  /** Separator progress 0..1 (only the separator after a step). */
  separatorProgress?: number;
}

const StepperStep = ({
  children,
  className,
  status = 'inactive',
  separatorProgress,
  ...props
}: StepperStepProps) => {
  const { slots } = useContext(StepperContext);

  return (
    <li
      className={composeSlotClassName(slots?.step, className)}
      data-status={status}
      data-slot="stepper-step"
      {...props}
    >
      {children}
    </li>
  );
};

/* -------------------------------------------------------------------------------------------------
 * Stepper StepButton
 * -----------------------------------------------------------------------------------------------*/

interface StepperStepButtonProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Whether the step is clickable (shows hover/focus affordances). @default false */
  clickable?: boolean;
}

const StepperStepButton = ({
  children,
  className,
  clickable = false,
  ...props
}: StepperStepButtonProps) => {
  const { slots } = useContext(StepperContext);

  return (
    <div
      className={composeSlotClassName(slots?.stepButton, className)}
      data-clickable={clickable || undefined}
      data-slot="stepper-step-button"
      {...props}
    >
      {children}
    </div>
  );
};

/* -------------------------------------------------------------------------------------------------
 * Stepper Indicator
 * -----------------------------------------------------------------------------------------------*/

interface StepperIndicatorProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
}

const StepperIndicator = ({ children, className, ...props }: StepperIndicatorProps) => {
  const { slots } = useContext(StepperContext);

  return (
    <div
      className={composeSlotClassName(slots?.indicator, className)}
      data-slot="stepper-indicator"
      {...props}
    >
      {children}
    </div>
  );
};

/* -------------------------------------------------------------------------------------------------
 * Stepper Icon
 * -----------------------------------------------------------------------------------------------*/

interface StepperIconProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
}

const StepperIcon = ({ children, className, ...props }: StepperIconProps) => {
  const { slots } = useContext(StepperContext);

  return (
    <div
      className={composeSlotClassName(slots?.icon, className)}
      data-slot="stepper-icon"
      {...props}
    >
      {children}
    </div>
  );
};

/* -------------------------------------------------------------------------------------------------
 * Stepper Content / Title / Description
 * -----------------------------------------------------------------------------------------------*/

interface StepperContentProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
}

const StepperContent = ({ children, className, ...props }: StepperContentProps) => {
  const { slots } = useContext(StepperContext);

  return (
    <div
      className={composeSlotClassName(slots?.content, className)}
      data-slot="stepper-content"
      {...props}
    >
      {children}
    </div>
  );
};

interface StepperTitleProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
}

const StepperTitle = ({ children, className, ...props }: StepperTitleProps) => {
  const { slots } = useContext(StepperContext);

  return (
    <div
      className={composeSlotClassName(slots?.title, className)}
      data-slot="stepper-title"
      {...props}
    >
      {children}
    </div>
  );
};

interface StepperDescriptionProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
}

const StepperDescription = ({ children, className, ...props }: StepperDescriptionProps) => {
  const { slots } = useContext(StepperContext);

  return (
    <div
      className={composeSlotClassName(slots?.description, className)}
      data-slot="stepper-description"
      {...props}
    >
      {children}
    </div>
  );
};

/* -------------------------------------------------------------------------------------------------
 * Stepper Separator
 * -----------------------------------------------------------------------------------------------*/

interface StepperSeparatorProps extends ComponentPropsWithRef<'div'> {
  /** Fill progress 0..1. @default 0 */
  progress?: number;
}

const StepperSeparator = ({ className, progress = 0, ...props }: StepperSeparatorProps) => {
  const { slots } = useContext(StepperContext);

  return (
    <div
      className={composeSlotClassName(slots?.separator, className)}
      data-slot="stepper-separator"
      aria-hidden="true"
      {...props}
    >
      <div className={composeSlotClassName(slots?.separatorTrack)} data-slot="stepper-separator-track">
        <div
          className={composeSlotClassName(slots?.separatorFill)}
          data-slot="stepper-separator-fill"
          style={{ '--stepper-separator-progress': progress } as React.CSSProperties}
        />
      </div>
    </div>
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
  StepperStepButton,
  StepperTitle,
};

export type {
  StepperContentProps,
  StepperDescriptionProps,
  StepperIconProps,
  StepperIndicatorProps,
  StepperRootProps,
  StepperSeparatorProps,
  StepperStepButtonProps,
  StepperStepProps,
  StepperTitleProps,
};
