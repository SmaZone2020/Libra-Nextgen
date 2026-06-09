'use client';

import type { ComponentPropsWithRef } from 'react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import type { Key } from 'react-aria-components/Breadcrumbs';
import { SelectionIndicator } from 'react-aria-components/SelectionIndicator';
import {
  ToggleButton as ToggleButtonPrimitive,
  ToggleButtonGroup as ToggleButtonGroupPrimitive,
} from 'react-aria-components/ToggleButtonGroup';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { SegmentVariants } from './segment.styles';
import { segmentVariants } from './segment.styles';

type SegmentContextValue = {
  slots: ReturnType<typeof segmentVariants>;
};

const SegmentContext = createContext<SegmentContextValue>(
  {} as SegmentContextValue
);

interface SegmentRootProps extends Omit<
  ComponentPropsWithRef<typeof ToggleButtonGroupPrimitive>,
  'selectionMode' | 'selectedKeys' | 'defaultSelectedKeys' | 'onSelectionChange'
> {
  className?: string;
  selectedKey?: Key | null;
  defaultSelectedKey?: Key;
  onSelectionChange?: (key: Key) => void;
  isDisabled?: boolean;
  size?: SegmentVariants['size'];
  variant?: SegmentVariants['variant'];
}

const SegmentRoot = ({
  children,
  className,
  defaultSelectedKey,
  isDisabled,
  onSelectionChange,
  selectedKey,
  size = 'md',
  variant = 'default',
  ...props
}: SegmentRootProps) => {
  const slots = useMemo(
    () => segmentVariants({ size, variant }),
    [size, variant]
  );
  const handleSelectionChange = useCallback(
    (selection: Set<Key>) => {
      const key = selection.values().next().value;
      if (key != null) onSelectionChange?.(key);
    },
    [onSelectionChange]
  );

  return (
    <SegmentContext.Provider value={{ slots }}>
      <ToggleButtonGroupPrimitive
        disallowEmptySelection
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="segment"
        defaultSelectedKeys={
          defaultSelectedKey != null ? [defaultSelectedKey] : undefined
        }
        isDisabled={isDisabled}
        orientation="horizontal"
        selectedKeys={selectedKey != null ? [selectedKey] : undefined}
        selectionMode="single"
        onSelectionChange={handleSelectionChange}
        {...props}
      >
        {(renderProps) =>
          typeof children === 'function' ? children(renderProps) : children
        }
      </ToggleButtonGroupPrimitive>
    </SegmentContext.Provider>
  );
};

interface SegmentItemProps extends ComponentPropsWithRef<
  typeof ToggleButtonPrimitive
> {
  className?: string;
}

const SegmentItem = ({ children, className, ...props }: SegmentItemProps) => {
  const { slots } = useContext(SegmentContext);

  return (
    <ToggleButtonPrimitive
      className={composeTwRenderProps(className, slots?.item())}
      data-slot="segment-item"
      {...props}
    >
      {(renderProps) => (
        <>
          <SelectionIndicator
            className={composeSlotClassName(slots?.indicator)}
            data-slot="segment-indicator"
          />
          {typeof children === 'function' ? children(renderProps) : children}
        </>
      )}
    </ToggleButtonPrimitive>
  );
};

interface SegmentSeparatorProps extends ComponentPropsWithRef<'span'> {
  className?: string;
}

const SegmentSeparator = ({ className, ...props }: SegmentSeparatorProps) => {
  const { slots } = useContext(SegmentContext);

  return (
    <span
      aria-hidden="true"
      className={composeSlotClassName(slots?.separator, className)}
      data-slot="segment-separator"
      {...props}
    />
  );
};

export { SegmentItem, SegmentRoot, SegmentSeparator };
export type { SegmentItemProps, SegmentRootProps, SegmentSeparatorProps };
