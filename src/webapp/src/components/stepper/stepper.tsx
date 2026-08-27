'use client';

import type { ComponentPropsWithRef, ReactNode, SVGProps } from 'react';
import { Children, cloneElement, createContext, isValidElement, useContext, useMemo, useState } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import type { StepperVariants } from './stepper.styles';
import { stepperVariants } from './stepper.styles';

/** 步骤状态：inactive / active / complete（与 stepper.css 的 data-status 对齐）。 */
export type StepperStepStatus = 'inactive' | 'active' | 'complete';

interface StepperContextValue {
  slots?: ReturnType<typeof stepperVariants>;
  orientation?: StepperVariants['orientation'];
  size?: StepperVariants['size'];
  /** 当前受控/非受控步索引（0-based）。 */
  step: number;
  /** 更新步索引（非受控时更新内部 state，受控时只触发 onStepChange）。 */
  setStep: (next: number) => void;
  /** 步骤总数（用于 isLast 判定）。 */
  count: number;
}

const StepperContext = createContext<StepperContextValue>({
  step: 0,
  setStep: () => {},
  count: 0,
});

interface StepperStepContextValue {
  /** 零基步索引。 */
  index: number;
  /** 由 currentStep 推导的状态。 */
  status: StepperStepStatus;
  /** 是否最后一步。 */
  isLast: boolean;
}

const StepperStepContext = createContext<StepperStepContextValue | null>(null);

/**
 * 从任意 Stepper.Step 后代访问该步的上下文（index / status / isLast）。
 * 在 Step 外部调用返回默认值（index 0 / inactive / isLast false）。
 */
export function useStepperStep(): StepperStepContextValue {
  const ctx = useContext(StepperStepContext);
  return ctx ?? { index: 0, status: 'inactive', isLast: false };
}

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
  /** 当前激活步索引（受控）。 */
  currentStep?: number;
  /** 初始步索引（非受控）。@default 0 */
  defaultStep?: number;
  /** 点击步骤时回调；提供后步骤变为可交互。 */
  onStepChange?: (step: number) => void;
}

/** 注入给 Stepper.Step 的内部索引 prop（cloneElement 时写入，不透传到 DOM）。 */
interface StepperStepInternalProps {
  __index?: number;
}

const StepperRoot = ({
  children,
  className,
  orientation = 'horizontal',
  size = 'md',
  currentStep,
  defaultStep = 0,
  onStepChange,
  ...props
}: StepperRootProps) => {
  const slots = useMemo(() => stepperVariants({ orientation, size }), [orientation, size]);
  const [internalStep, setInternalStep] = useState(defaultStep);

  const step = currentStep ?? internalStep;
  const setStep = (next: number) => {
    setInternalStep(next);
    onStepChange?.(next);
  };

  // 把步索引注入每个 Stepper.Step，使 Step 上下文（index/status/isLast）可用。
  const count = Children.count(children);
  const steps = Children.map(children, (child, index) =>
    isValidElement<StepperStepInternalProps>(child)
      ? cloneElement(child, { __index: index })
      : child,
  );

  return (
    <StepperContext.Provider value={{ slots, orientation, size, step, setStep, count }}>
      <ol
        className={composeSlotClassName(slots?.base, className)}
        data-orientation={orientation}
        data-slot="stepper"
        {...props}
      >
        {steps}
      </ol>
    </StepperContext.Provider>
  );
};

/* -------------------------------------------------------------------------------------------------
 * Stepper Step
 * -----------------------------------------------------------------------------------------------*/

interface StepperStepProps extends ComponentPropsWithRef<'li'>, StepperStepInternalProps {
  children: ReactNode;
}

const StepperStep = ({ children, className, __index = 0, ...props }: StepperStepProps) => {
  const { slots, step, count } = useContext(StepperContext);

  const status: StepperStepStatus =
    __index < step ? 'complete' : __index === step ? 'active' : 'inactive';
  const isLast = __index === count - 1;

  return (
    <StepperStepContext.Provider value={{ index: __index, status, isLast }}>
      <li
        className={composeSlotClassName(slots?.step, className)}
        data-status={status}
        data-slot="stepper-step"
        {...props}
      >
        {children}
      </li>
    </StepperStepContext.Provider>
  );
};

/* -------------------------------------------------------------------------------------------------
 * Stepper StepButton（可选包装：可点击步骤的交互/悬停目标）
 * -----------------------------------------------------------------------------------------------*/

interface StepperStepButtonProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** 点击该步骤时调用（使用 Root 的 setStep）。 */
  onStepPress?: () => void;
}

const StepperStepButton = ({
  children,
  className,
  onStepPress,
  ...props
}: StepperStepButtonProps) => {
  const { slots } = useContext(StepperContext);
  const { index } = useStepperStep();

  return (
    <div
      className={composeSlotClassName(slots?.stepButton, className)}
      data-clickable={onStepPress ? true : undefined}
      data-slot="stepper-step-button"
      onClick={onStepPress ?? (() => {})}
      role={onStepPress ? 'button' : undefined}
      tabIndex={onStepPress ? 0 : undefined}
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
  /** 自定义内容（覆盖默认的序号 / 完成对勾）。 */
  children?: ReactNode;
}

const StepperIndicator = ({ children, className, ...props }: StepperIndicatorProps) => {
  const { slots } = useContext(StepperContext);
  const { index, status } = useStepperStep();

  return (
    <div
      className={composeSlotClassName(slots?.indicator, className)}
      data-status={status}
      data-slot="stepper-indicator"
      {...props}
    >
      {children ?? (
        status === 'complete' ? (
          <StepperIcon><DEFAULT_CHECKMARK /></StepperIcon>
        ) : (
          <StepperIcon><span>{index + 1}</span></StepperIcon>
        )
      )}
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
  /** 显式进度 0..1；省略时按 currentStep 自动计算。 */
  progress?: number;
  /** 即使位于最后一步也强制渲染。@default false */
  force?: boolean;
}

const StepperSeparator = ({ className, progress, force = false, ...props }: StepperSeparatorProps) => {
  const { slots, step } = useContext(StepperContext);
  const { index, isLast } = useStepperStep();

  // 最后一步自动隐藏（除非 force）。
  if (isLast && !force) return null;

  // 自动进度：已完成步 1，当前步 0.5，未到 0。
  const p = progress ?? (index < step ? 1 : index === step ? 0.5 : 0);

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
          style={{ '--stepper-separator-progress': p } as React.CSSProperties}
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
