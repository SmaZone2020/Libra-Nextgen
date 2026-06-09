'use client';

import type { ComponentPropsWithRef, ReactNode, SVGProps } from 'react';
import React, { createContext, useContext, useMemo } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import type { NativeSelectVariants } from './native-select.styles';
import { nativeSelectVariants } from './native-select.styles';

interface NativeSelectContextValue {
  slots?: ReturnType<typeof nativeSelectVariants>;
}

const NativeSelectContext = createContext<NativeSelectContextValue>({});

interface NativeSelectRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Whether the select should take up the full width of its container. */
  fullWidth?: NativeSelectVariants['fullWidth'];
  /** The visual variant. @default "primary" */
  variant?: NativeSelectVariants['variant'];
}

const NativeSelectRoot = ({
  children,
  className,
  fullWidth,
  variant,
  ...props
}: NativeSelectRootProps) => {
  const slots = useMemo(
    () => nativeSelectVariants({ fullWidth, variant }),
    [fullWidth, variant]
  );

  return (
    <NativeSelectContext.Provider value={{ slots }}>
      <div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="native-select"
        {...props}
      >
        {children}
      </div>
    </NativeSelectContext.Provider>
  );
};

interface NativeSelectTriggerProps extends Omit<
  ComponentPropsWithRef<'select'>,
  'className'
> {
  children: ReactNode;
  className?: string;
  /** Additional className applied to the wrapper div (trigger slot). */
  wrapperClassName?: string;
}

const NativeSelectTrigger = ({
  children,
  className,
  wrapperClassName,
  ...selectProps
}: NativeSelectTriggerProps) => {
  const { slots } = useContext(NativeSelectContext);

  let indicator: React.ReactElement | null = null;
  const options: ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === NativeSelectIndicator) {
      indicator = child;
    } else {
      options.push(child);
    }
  });

  return (
    <div
      className={composeSlotClassName(slots?.trigger, wrapperClassName)}
      data-slot="native-select-trigger"
    >
      <select
        className={composeSlotClassName(slots?.select, className)}
        data-slot="native-select-select"
        {...selectProps}
      >
        {options}
      </select>
      {indicator ?? <NativeSelectIndicator />}
    </div>
  );
};

interface NativeSelectIndicatorProps extends ComponentPropsWithRef<'span'> {}

const NativeSelectIndicator = ({
  children,
  className,
  ...props
}: NativeSelectIndicatorProps) => {
  const { slots } = useContext(NativeSelectContext);

  return (
    <span
      aria-hidden="true"
      className={composeSlotClassName(slots?.indicator, className)}
      data-slot="native-select-indicator"
      {...props}
    >
      {children ?? <ChevronDownIcon />}
    </span>
  );
};

const ChevronDownIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

interface NativeSelectOptionProps extends ComponentPropsWithRef<'option'> {}

const NativeSelectOption = ({
  children,
  ...props
}: NativeSelectOptionProps) => <option {...props}>{children}</option>;

interface NativeSelectOptGroupProps extends ComponentPropsWithRef<'optgroup'> {}

const NativeSelectOptGroup = ({
  children,
  ...props
}: NativeSelectOptGroupProps) => <optgroup {...props}>{children}</optgroup>;

export {
  NativeSelectIndicator,
  NativeSelectOptGroup,
  NativeSelectOption,
  NativeSelectRoot,
  NativeSelectTrigger,
};

export type {
  NativeSelectIndicatorProps,
  NativeSelectOptGroupProps,
  NativeSelectOptionProps,
  NativeSelectRootProps,
  NativeSelectTriggerProps,
};
