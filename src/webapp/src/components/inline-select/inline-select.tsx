'use client';

import type { ComponentProps } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { SelectRootProps } from '@heroui/react';
import { Select } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { ChevronsExpandVertical } from '../icons';
import { inlineSelectVariants } from './inline-select.styles';

// ---- Context ----

type InlineSelectContextValue = {
  slots?: ReturnType<typeof inlineSelectVariants>;
};

const InlineSelectContext = createContext<InlineSelectContextValue>({});

// ---- Types ----

export interface InlineSelectRootProps<
  T extends object = object,
  M extends 'single' | 'multiple' = 'single',
> extends SelectRootProps<T, M> {}

export interface InlineSelectTriggerProps extends ComponentProps<
  typeof Select.Trigger
> {}

export interface InlineSelectValueProps extends ComponentProps<
  typeof Select.Value
> {}

export interface InlineSelectIndicatorProps extends ComponentProps<
  typeof Select.Indicator
> {}

export interface InlineSelectPopoverProps extends ComponentProps<
  typeof Select.Popover
> {}

// ---- Components ----

export const InlineSelectRoot = <
  T extends object = object,
  M extends 'single' | 'multiple' = 'single',
>({
  children,
  className,
  ...props
}: InlineSelectRootProps<T, M>) => {
  const slots = useMemo(() => inlineSelectVariants(), []);
  return (
    <InlineSelectContext.Provider value={{ slots }}>
      <Select
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="inline-select"
        {...props}
      >
        {children}
      </Select>
    </InlineSelectContext.Provider>
  );
};

export const InlineSelectTrigger = ({
  children,
  className,
  ...props
}: InlineSelectTriggerProps) => {
  const { slots } = useContext(InlineSelectContext);
  return (
    <Select.Trigger
      className={composeTwRenderProps(className, slots?.trigger())}
      data-slot="inline-select-trigger"
      {...props}
    >
      {children}
    </Select.Trigger>
  );
};

export const InlineSelectValue = ({
  children,
  className,
  ...props
}: InlineSelectValueProps) => {
  const { slots } = useContext(InlineSelectContext);
  return (
    <Select.Value
      className={composeTwRenderProps(className, slots?.value())}
      data-slot="inline-select-value"
      {...props}
    >
      {children}
    </Select.Value>
  );
};

export const InlineSelectIndicator = ({
  children,
  className,
  ...props
}: InlineSelectIndicatorProps) => {
  const { slots } = useContext(InlineSelectContext);
  return (
    <Select.Indicator
      className={composeSlotClassName(slots?.indicator, className)}
      data-slot="inline-select-indicator"
      {...props}
    >
      {children === undefined ? <ChevronsExpandVertical /> : children}
    </Select.Indicator>
  );
};

export const InlineSelectPopover = ({
  children,
  className,
  placement = 'bottom end',
  ...props
}: InlineSelectPopoverProps) => {
  const { slots } = useContext(InlineSelectContext);
  return (
    <Select.Popover
      className={composeTwRenderProps(className, slots?.popover())}
      data-slot="inline-select-popover"
      placement={placement}
      {...props}
    >
      {children}
    </Select.Popover>
  );
};
