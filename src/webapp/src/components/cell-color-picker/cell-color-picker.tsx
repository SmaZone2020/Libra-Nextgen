'use client';

import type { ComponentProps, ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Button as ButtonPrimitive } from 'react-aria-components/Button';
import type { ColorPickerProps as ColorPickerPrimitiveProps } from 'react-aria-components/ColorPicker';
import { ColorPickerStateContext } from 'react-aria-components/ColorPicker';
import type { ColorPickerPopoverProps } from '@heroui/react';
import { ColorPicker, ColorSwatch } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { CellColorPickerVariants } from './cell-color-picker.styles';
import { cellColorPickerVariants } from './cell-color-picker.styles';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CellColorPickerRootProps extends Omit<
  ColorPickerPrimitiveProps,
  'children'
> {
  children: ReactNode;
  className?: string;
  /** Visual variant. @default "default" */
  variant?: CellColorPickerVariants['variant'];
}

export interface CellColorPickerTriggerProps extends ComponentPropsWithRef<
  typeof ButtonPrimitive
> {}

export interface CellColorPickerLabelProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

export interface CellColorPickerValueDisplayProps extends ComponentPropsWithRef<'span'> {}

export interface CellColorPickerSwatchProps extends ComponentProps<
  typeof ColorSwatch
> {}

export interface CellColorPickerPopoverProps extends ColorPickerPopoverProps {}

// ─── Internal context ─────────────────────────────────────────────────────────

type CellColorPickerContextValue = {
  slots: ReturnType<typeof cellColorPickerVariants>;
};

const CellColorPickerCtx = createContext<CellColorPickerContextValue>(
  {} as CellColorPickerContextValue
);

// ─── Components ───────────────────────────────────────────────────────────────

export const CellColorPickerRoot = ({
  children,
  className,
  variant = 'default',
  ...props
}: CellColorPickerRootProps) => {
  const slots = useMemo(() => cellColorPickerVariants({ variant }), [variant]);

  return (
    <CellColorPickerCtx.Provider value={{ slots }}>
      <ColorPicker
        className={composeSlotClassName(slots?.base, className)}
        {...props}
      >
        {children}
      </ColorPicker>
    </CellColorPickerCtx.Provider>
  );
};

export const CellColorPickerTrigger = ({
  children,
  className,
  ...props
}: CellColorPickerTriggerProps) => {
  const { slots } = useContext(CellColorPickerCtx);

  return (
    <ButtonPrimitive
      className={composeTwRenderProps(className, slots?.trigger())}
      data-slot="cell-color-picker-trigger"
      {...props}
    >
      {(renderProps) =>
        typeof children === 'function' ? children(renderProps) : children
      }
    </ButtonPrimitive>
  );
};

export const CellColorPickerLabel = ({
  children,
  className,
  ...props
}: CellColorPickerLabelProps) => {
  const { slots } = useContext(CellColorPickerCtx);

  return (
    <span
      className={composeSlotClassName(slots?.label, className)}
      data-slot="cell-color-picker-label"
      {...props}
    >
      {children}
    </span>
  );
};

export const CellColorPickerValueDisplay = ({
  children,
  className,
  ...props
}: CellColorPickerValueDisplayProps) => {
  const { slots } = useContext(CellColorPickerCtx);
  const colorState = useContext(ColorPickerStateContext);
  const displayValue = colorState?.color
    ? colorState.color.toString('hex').toUpperCase()
    : '';

  return (
    <span
      className={composeSlotClassName(slots?.valueDisplay, className)}
      data-slot="cell-color-picker-value-display"
      {...props}
    >
      {children ?? displayValue}
    </span>
  );
};

export const CellColorPickerSwatch = ({
  className,
  ...props
}: CellColorPickerSwatchProps) => {
  const { slots } = useContext(CellColorPickerCtx);

  return (
    <ColorSwatch
      className={composeTwRenderProps(className, slots?.swatch())}
      data-slot="cell-color-picker-swatch"
      {...props}
    />
  );
};

export const CellColorPickerPopover = ({
  children,
  className,
  placement = 'bottom end',
  ...props
}: CellColorPickerPopoverProps) => {
  const { slots } = useContext(CellColorPickerCtx);
  const composedClassName = composeSlotClassName(
    slots?.popover,
    className as string | undefined
  );

  return (
    <ColorPicker.Popover
      className={composedClassName}
      data-slot="cell-color-picker-popover"
      placement={placement}
      {...props}
    >
      {children}
    </ColorPicker.Popover>
  );
};
