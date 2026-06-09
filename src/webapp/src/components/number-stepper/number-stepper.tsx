'use client';

import type { ComponentPropsWithRef } from 'react';
import React, {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { Button as ButtonPrimitive } from 'react-aria-components/Button';
import { Group as GroupPrimitive } from 'react-aria-components/Group';
import { Input } from 'react-aria-components/Input';
import { NumberField as NumberFieldPrimitive } from 'react-aria-components/NumberField';
import type { Format } from '@number-flow/react';
import NumberFlow from '@number-flow/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { Minus, Plus } from '../icons';
import type { NumberStepperVariants } from './number-stepper.styles';
import { numberStepperVariants } from './number-stepper.styles';

type NumberStepperContextValue = {
  formatOptions?: Format;
  slots?: ReturnType<typeof numberStepperVariants>;
  value: number;
};

const NumberStepperContext = createContext<NumberStepperContextValue>({
  value: 0,
});

export interface NumberStepperRootProps
  extends
    ComponentPropsWithRef<typeof NumberFieldPrimitive>,
    NumberStepperVariants {
  formatOptions?: Format;
}

export const NumberStepperRoot = ({
  children,
  className,
  formatOptions,
  size = 'md',
  ...props
}: NumberStepperRootProps) => {
  const slots = useMemo(() => numberStepperVariants({ size }), [size]);
  const [internalValue, setInternalValue] = useState<number>(
    () => (props.value ?? props.defaultValue ?? 0) as number
  );
  const controlledValue =
    props.value != null ? (props.value as number) : internalValue;

  return jsx(NumberStepperContext, {
    value: { formatOptions, slots, value: controlledValue },
    children: jsx(NumberFieldPrimitive, {
      className: composeTwRenderProps(className, slots?.base()),
      'data-slot': 'number-stepper',
      ...props,
      value: controlledValue,
      onChange: (val: number) => {
        setInternalValue(val);
        (props.onChange as ((v: number) => void) | undefined)?.(val);
      },
      children: (renderProps: object) =>
        jsx(Fragment, {
          children:
            typeof children === 'function'
              ? (children as (r: object) => ReactNode)(renderProps)
              : children,
        }),
    }),
  });
};

export interface NumberStepperGroupProps extends ComponentPropsWithRef<
  typeof GroupPrimitive
> {}

export const NumberStepperGroup = ({
  children,
  className,
  ...props
}: NumberStepperGroupProps) => {
  const { slots } = useContext(NumberStepperContext);
  return jsx(GroupPrimitive, {
    className: composeTwRenderProps(className, slots?.group()),
    'data-slot': 'number-stepper-group',
    ...props,
    children: (renderProps: object) =>
      jsxs(Fragment, {
        children: [
          typeof children === 'function'
            ? (children as (r: object) => ReactNode)(renderProps)
            : children,
          jsx(Input, {
            className: slots?.input(),
            'data-slot': 'number-stepper-input',
            tabIndex: -1,
          }),
        ],
      }),
  });
};

export type NumberStepperValueRenderProps = {
  formatOptions?: Format;
  value: number;
};

export interface NumberStepperValueProps extends Omit<
  ComponentPropsWithRef<typeof NumberFlow>,
  'value' | 'children'
> {
  children?:
    | ((props: NumberStepperValueRenderProps) => React.ReactNode)
    | React.ReactNode;
  value?: number;
}

export const NumberStepperValue = ({
  children,
  className,
  format,
  value: valueProp,
  ...props
}: NumberStepperValueProps) => {
  const ctx = useContext(NumberStepperContext);
  const resolvedValue = valueProp ?? ctx.value;
  const resolvedFormat = format ?? ctx.formatOptions;
  const composedClassName = composeSlotClassName(ctx.slots?.value, className);

  if (typeof children === 'function') {
    return jsx('span', {
      className: composedClassName,
      'data-slot': 'number-stepper-value',
      children: (children as (r: NumberStepperValueRenderProps) => ReactNode)({
        formatOptions: resolvedFormat,
        value: resolvedValue,
      }),
    });
  }

  if (children) {
    return jsx('span', {
      className: composedClassName,
      'data-slot': 'number-stepper-value',
      children,
    });
  }

  return jsx(NumberFlow, {
    className: composedClassName,
    'data-slot': 'number-stepper-value',
    format: resolvedFormat,
    value: resolvedValue,
    ...props,
  });
};

export interface NumberStepperDecrementButtonProps extends ComponentPropsWithRef<
  typeof ButtonPrimitive
> {}

export const NumberStepperDecrementButton = ({
  children,
  className,
  ...props
}: NumberStepperDecrementButtonProps) => {
  const { slots } = useContext(NumberStepperContext);
  return jsx(ButtonPrimitive, {
    className: composeTwRenderProps(className, slots?.decrementButton()),
    'data-slot': 'number-stepper-decrement-button',
    slot: 'decrement',
    ...props,
    children:
      children && React.isValidElement(children) ? children : jsx(Minus, {}),
  });
};

export interface NumberStepperIncrementButtonProps extends ComponentPropsWithRef<
  typeof ButtonPrimitive
> {}

export const NumberStepperIncrementButton = ({
  children,
  className,
  ...props
}: NumberStepperIncrementButtonProps) => {
  const { slots } = useContext(NumberStepperContext);
  return jsx(ButtonPrimitive, {
    className: composeTwRenderProps(className, slots?.incrementButton()),
    'data-slot': 'number-stepper-increment-button',
    slot: 'increment',
    ...props,
    children:
      children && React.isValidElement(children) ? children : jsx(Plus, {}),
  });
};
