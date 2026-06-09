'use client';

import type { ComponentPropsWithRef } from 'react';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { Button as AriaButton } from 'react-aria-components/Button';
import { Radio, RadioGroup } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { RadioButtonGroupVariants } from './radio-button-group.styles';
import { radioButtonGroupVariants } from './radio-button-group.styles';

interface RadioButtonGroupRootProps extends ComponentPropsWithRef<
  typeof RadioGroup
> {
  /** Layout mode for items. @default "flex" */
  layout?: RadioButtonGroupVariants['layout'];
}

interface RadioButtonGroupItemProps extends ComponentPropsWithRef<
  typeof Radio
> {}

interface RadioButtonGroupIndicatorProps extends ComponentPropsWithRef<'span'> {}

interface RadioButtonGroupItemContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

interface RadioButtonGroupItemIconProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

type RadioButtonGroupContextValue = {
  slots: ReturnType<typeof radioButtonGroupVariants>;
};

const RadioButtonGroupContext = createContext<RadioButtonGroupContextValue>(
  {} as RadioButtonGroupContextValue
);

const RadioButtonGroupRoot = ({
  children,
  className,
  layout = 'flex',
  ...props
}: RadioButtonGroupRootProps) => {
  const slots = useMemo(() => radioButtonGroupVariants({ layout }), [layout]);

  return (
    <RadioButtonGroupContext.Provider value={{ slots }}>
      <RadioGroup
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="radio-button-group"
        {...props}
      >
        {(renderProps) => (
          <>
            {'function' === typeof children ? children(renderProps) : children}
          </>
        )}
      </RadioGroup>
    </RadioButtonGroupContext.Provider>
  );
};

const RadioButtonGroupItem = ({
  children,
  className,
  ...props
}: RadioButtonGroupItemProps) => {
  const { slots } = useContext(RadioButtonGroupContext);

  return (
    <Radio
      className={composeTwRenderProps(className, slots?.item())}
      data-slot="radio-button-group-item"
      {...props}
    >
      {(renderProps) => (
        <>{'function' === typeof children ? children(renderProps) : children}</>
      )}
    </Radio>
  );
};

const RadioButtonGroupIndicator = ({
  children,
  className,
  ...props
}: RadioButtonGroupIndicatorProps) => {
  const { slots } = useContext(RadioButtonGroupContext);

  if (children == null) {
    return (
      <Radio.Control
        className={composeSlotClassName(slots?.indicator, className)}
        data-slot="radio-button-group-indicator"
        {...props}
      >
        <Radio.Indicator />
      </Radio.Control>
    );
  }

  return (
    <span
      className={composeSlotClassName(slots?.indicator, className)}
      data-custom="true"
      data-slot="radio-button-group-indicator"
      {...props}
    >
      {children}
    </span>
  );
};

const RadioButtonGroupItemContent = ({
  children,
  className,
  ...props
}: RadioButtonGroupItemContentProps) => {
  const { slots } = useContext(RadioButtonGroupContext);

  return (
    <Radio.Content
      className={composeSlotClassName(slots?.itemContent, className)}
      data-slot="radio-button-group-item-content"
      {...props}
    >
      {children}
    </Radio.Content>
  );
};

const RadioButtonGroupItemIcon = ({
  children,
  className,
  ...props
}: RadioButtonGroupItemIconProps) => {
  const { slots } = useContext(RadioButtonGroupContext);

  return (
    <div
      className={composeSlotClassName(slots?.itemIcon, className)}
      data-slot="radio-button-group-item-icon"
      {...props}
    >
      {children}
    </div>
  );
};

export {
  RadioButtonGroupIndicator,
  RadioButtonGroupItem,
  RadioButtonGroupItemContent,
  RadioButtonGroupItemIcon,
  RadioButtonGroupRoot,
};
export type {
  RadioButtonGroupIndicatorProps,
  RadioButtonGroupItemContentProps,
  RadioButtonGroupItemIconProps,
  RadioButtonGroupItemProps,
  RadioButtonGroupRootProps,
};
