'use client';

import type { ComponentProps, ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { SelectRootProps } from '@heroui/react';
import { Select } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { ChevronsExpandVertical } from '../icons';
import type { CellSelectVariants } from './cell-select.styles';
import { cellSelectVariants } from './cell-select.styles';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CellSelectRootProps<
  T extends object = object,
  M extends 'single' | 'multiple' = 'single',
> extends Omit<SelectRootProps<T, M>, 'variant'> {
  /** Visual variant. @default "default" */
  variant?: CellSelectVariants['variant'];
}

export interface CellSelectTriggerProps extends ComponentProps<
  typeof Select.Trigger
> {}
export interface CellSelectLabelProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}
export interface CellSelectValueProps extends ComponentProps<
  typeof Select.Value
> {}
export interface CellSelectIndicatorProps extends ComponentProps<
  typeof Select.Indicator
> {}
export interface CellSelectPopoverProps extends ComponentProps<
  typeof Select.Popover
> {}

// ─── Internal context ─────────────────────────────────────────────────────────

type CellSelectContextValue = {
  slots: ReturnType<typeof cellSelectVariants>;
};

const CellSelectCtx = createContext<CellSelectContextValue>(
  {} as CellSelectContextValue
);

// ─── Components ───────────────────────────────────────────────────────────────

export const CellSelectRoot = <
  T extends object = object,
  M extends 'single' | 'multiple' = 'single',
>({
  children,
  className,
  variant = 'default',
  ...props
}: CellSelectRootProps<T, M>) => {
  const slots = useMemo(() => cellSelectVariants({ variant }), [variant]);

  return (
    <CellSelectCtx.Provider value={{ slots }}>
      <Select
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="cell-select"
        {...props}
      >
        {children}
      </Select>
    </CellSelectCtx.Provider>
  );
};

export const CellSelectTrigger = ({
  children,
  className,
  ...props
}: CellSelectTriggerProps) => {
  const { slots } = useContext(CellSelectCtx);
  return (
    <Select.Trigger
      className={composeTwRenderProps(className, slots?.trigger())}
      data-slot="cell-select-trigger"
      {...props}
    >
      {children}
    </Select.Trigger>
  );
};

export const CellSelectLabel = ({
  children,
  className,
  ...props
}: CellSelectLabelProps) => {
  const { slots } = useContext(CellSelectCtx);
  return (
    <span
      className={composeSlotClassName(slots?.label, className)}
      data-slot="cell-select-label"
      {...props}
    >
      {children}
    </span>
  );
};

export const CellSelectValue = ({
  children,
  className,
  ...props
}: CellSelectValueProps) => {
  const { slots } = useContext(CellSelectCtx);
  return (
    <Select.Value
      className={composeTwRenderProps(className, slots?.value())}
      data-slot="cell-select-value"
      {...props}
    >
      {children}
    </Select.Value>
  );
};

export const CellSelectIndicator = ({
  children,
  className,
  ...props
}: CellSelectIndicatorProps) => {
  const { slots } = useContext(CellSelectCtx);
  return (
    <Select.Indicator
      className={composeSlotClassName(slots?.indicator, className)}
      data-slot="cell-select-indicator"
      {...props}
    >
      {children === undefined ? <ChevronsExpandVertical /> : children}
    </Select.Indicator>
  );
};

export const CellSelectPopover = ({
  children,
  className,
  placement = 'bottom end',
  ...props
}: CellSelectPopoverProps) => {
  const { slots } = useContext(CellSelectCtx);
  return (
    <Select.Popover
      className={composeTwRenderProps(className, slots?.popover())}
      data-slot="cell-select-popover"
      placement={placement}
      {...props}
    >
      {children}
    </Select.Popover>
  );
};
