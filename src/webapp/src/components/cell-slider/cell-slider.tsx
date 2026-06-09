'use client';

import type { ComponentProps, ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Slider } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { CellSliderVariants } from './cell-slider.styles';
import { cellSliderVariants } from './cell-slider.styles';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CellSliderRootProps extends Omit<
  ComponentProps<typeof Slider>,
  'variant' | 'orientation'
> {
  /** Visual variant. @default "default" */
  variant?: CellSliderVariants['variant'];
}

export interface CellSliderTrackProps extends ComponentProps<
  typeof Slider.Track
> {}
export interface CellSliderFillProps extends ComponentProps<
  typeof Slider.Fill
> {}
export interface CellSliderThumbProps extends ComponentProps<
  typeof Slider.Thumb
> {}
export interface CellSliderLabelProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}
export interface CellSliderOutputProps extends ComponentProps<
  typeof Slider.Output
> {}

// ─── Internal context ─────────────────────────────────────────────────────────

type CellSliderContextValue = {
  slots: ReturnType<typeof cellSliderVariants>;
};

const CellSliderCtx = createContext<CellSliderContextValue>(
  {} as CellSliderContextValue
);

// ─── Components ───────────────────────────────────────────────────────────────

export const CellSliderRoot = ({
  children,
  className,
  variant = 'default',
  ...props
}: CellSliderRootProps) => {
  const slots = useMemo(() => cellSliderVariants({ variant }), [variant]);

  return (
    <CellSliderCtx.Provider value={{ slots }}>
      <Slider
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="cell-slider"
        orientation="horizontal"
        {...props}
      >
        {children}
      </Slider>
    </CellSliderCtx.Provider>
  );
};

export const CellSliderTrack = ({
  children,
  className,
  ...props
}: CellSliderTrackProps) => {
  const { slots } = useContext(CellSliderCtx);
  return (
    <Slider.Track
      className={composeTwRenderProps(className, slots?.track())}
      data-slot="cell-slider-track"
      {...props}
    >
      {children}
    </Slider.Track>
  );
};

export const CellSliderFill = ({
  className,
  ...props
}: CellSliderFillProps) => {
  const { slots } = useContext(CellSliderCtx);
  return (
    <Slider.Fill
      className={composeSlotClassName(slots?.fill, className)}
      data-slot="cell-slider-fill"
      {...props}
    />
  );
};

export const CellSliderThumb = ({
  children,
  className,
  ...props
}: CellSliderThumbProps) => {
  const { slots } = useContext(CellSliderCtx);
  return (
    <Slider.Thumb
      className={composeTwRenderProps(className, slots?.thumb())}
      data-slot="cell-slider-thumb"
      {...props}
    >
      {children}
    </Slider.Thumb>
  );
};

export const CellSliderLabel = ({
  children,
  className,
  ...props
}: CellSliderLabelProps) => {
  const { slots } = useContext(CellSliderCtx);
  return (
    <span
      className={composeSlotClassName(slots?.label, className)}
      data-slot="cell-slider-label"
      {...props}
    >
      {children}
    </span>
  );
};

export const CellSliderOutput = ({
  children,
  className,
  ...props
}: CellSliderOutputProps) => {
  const { slots } = useContext(CellSliderCtx);
  return (
    <Slider.Output
      className={composeTwRenderProps(className, slots?.output())}
      data-slot="cell-slider-output"
      {...props}
    >
      {children}
    </Slider.Output>
  );
};
