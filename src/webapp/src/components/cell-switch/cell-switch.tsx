'use client';

import type { ComponentProps, ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Switch } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { CellSwitchVariants } from './cell-switch.styles';
import { cellSwitchVariants } from './cell-switch.styles';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CellSwitchRootProps extends Omit<
  ComponentProps<typeof Switch>,
  'variant'
> {
  /** Visual variant. @default "default" */
  variant?: CellSwitchVariants['variant'];
}

export interface CellSwitchTriggerProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface CellSwitchLabelProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

export interface CellSwitchControlProps extends ComponentProps<
  typeof Switch.Control
> {}

// ─── Internal context ─────────────────────────────────────────────────────────

type CellSwitchContextValue = {
  slots: ReturnType<typeof cellSwitchVariants>;
};

const CellSwitchCtx = createContext<CellSwitchContextValue>(
  {} as CellSwitchContextValue
);

// ─── Components ───────────────────────────────────────────────────────────────

export const CellSwitchRoot = ({
  children,
  className,
  variant = 'default',
  ...props
}: CellSwitchRootProps) => {
  const slots = useMemo(() => cellSwitchVariants({ variant }), [variant]);

  return (
    <CellSwitchCtx.Provider value={{ slots }}>
      <Switch
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="cell-switch"
        {...props}
      >
        {children}
      </Switch>
    </CellSwitchCtx.Provider>
  );
};

export const CellSwitchTrigger = ({
  children,
  className,
  ...props
}: CellSwitchTriggerProps) => {
  const { slots } = useContext(CellSwitchCtx);
  return (
    <div
      className={composeSlotClassName(slots?.trigger, className)}
      data-slot="cell-switch-trigger"
      {...props}
    >
      {children}
    </div>
  );
};

export const CellSwitchLabel = ({
  children,
  className,
  ...props
}: CellSwitchLabelProps) => {
  const { slots } = useContext(CellSwitchCtx);
  return (
    <span
      className={composeSlotClassName(slots?.label, className)}
      data-slot="cell-switch-label"
      {...props}
    >
      {children}
    </span>
  );
};

export const CellSwitchControl = ({
  children,
  className,
  ...props
}: CellSwitchControlProps) => {
  const { slots } = useContext(CellSwitchCtx);
  return (
    <Switch.Control
      className={composeSlotClassName(slots?.control, className)}
      data-slot="cell-switch-control"
      {...props}
    >
      {children === undefined ? <Switch.Thumb /> : children}
    </Switch.Control>
  );
};
