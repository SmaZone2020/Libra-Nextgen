'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Checkbox, CheckboxGroup } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { CheckboxButtonGroupVariants } from './checkbox-button-group.styles';
import { checkboxButtonGroupVariants } from './checkbox-button-group.styles';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CheckboxButtonGroupRootProps extends ComponentPropsWithRef<
  typeof CheckboxGroup
> {
  /** Layout mode for items. @default "flex" */
  layout?: CheckboxButtonGroupVariants['layout'];
}

export interface CheckboxButtonGroupItemProps extends ComponentPropsWithRef<
  typeof Checkbox
> {}

export interface CheckboxButtonGroupIndicatorProps extends ComponentPropsWithRef<'span'> {}

export interface CheckboxButtonGroupItemContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface CheckboxButtonGroupItemIconProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

// ── Context ──────────────────────────────────────────────────────────────────

interface CheckboxButtonGroupContextValue {
  slots?: ReturnType<typeof checkboxButtonGroupVariants>;
}

const CheckboxButtonGroupContext =
  createContext<CheckboxButtonGroupContextValue>({});

// ── Components ───────────────────────────────────────────────────────────────

export const CheckboxButtonGroupRoot = ({
  children,
  className,
  layout = 'flex',
  ...props
}: CheckboxButtonGroupRootProps) => {
  const slots = useMemo(
    () => checkboxButtonGroupVariants({ layout }),
    [layout]
  );

  return (
    <CheckboxButtonGroupContext value={{ slots }}>
      <CheckboxGroup
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="checkbox-button-group"
        {...props}
      >
        {(state) => (
          <>{'function' === typeof children ? children(state) : children}</>
        )}
      </CheckboxGroup>
    </CheckboxButtonGroupContext>
  );
};

export const CheckboxButtonGroupItem = ({
  children,
  className,
  ...props
}: CheckboxButtonGroupItemProps) => {
  const { slots } = useContext(CheckboxButtonGroupContext);

  return (
    <Checkbox
      className={composeTwRenderProps(className, slots?.item())}
      data-slot="checkbox-button-group-item"
      {...props}
    >
      {(state) => (
        <>{'function' === typeof children ? children(state) : children}</>
      )}
    </Checkbox>
  );
};

export const CheckboxButtonGroupIndicator = ({
  children,
  className,
  ...props
}: CheckboxButtonGroupIndicatorProps) => {
  const { slots } = useContext(CheckboxButtonGroupContext);

  if (children == null) {
    return (
      <Checkbox.Control
        className={composeSlotClassName(slots?.indicator, className)}
        data-slot="checkbox-button-group-indicator"
        {...props}
      >
        <Checkbox.Indicator />
      </Checkbox.Control>
    );
  }

  return (
    <span
      className={composeSlotClassName(slots?.indicator, className)}
      data-custom="true"
      data-slot="checkbox-button-group-indicator"
      {...props}
    >
      {children}
    </span>
  );
};

export const CheckboxButtonGroupItemContent = ({
  children,
  className,
  ...props
}: CheckboxButtonGroupItemContentProps) => {
  const { slots } = useContext(CheckboxButtonGroupContext);

  return (
    <Checkbox.Content
      className={composeSlotClassName(slots?.itemContent, className)}
      data-slot="checkbox-button-group-item-content"
      {...props}
    >
      {children}
    </Checkbox.Content>
  );
};

export const CheckboxButtonGroupItemIcon = ({
  children,
  className,
  ...props
}: CheckboxButtonGroupItemIconProps) => {
  const { slots } = useContext(CheckboxButtonGroupContext);

  return (
    <div
      className={composeSlotClassName(slots?.itemIcon, className)}
      data-slot="checkbox-button-group-item-icon"
      {...props}
    >
      {children}
    </div>
  );
};
