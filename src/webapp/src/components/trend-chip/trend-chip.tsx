'use client';

import type { ComponentPropsWithRef } from 'react';
import React, {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';
import { Chip } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import type { TrendChipVariants } from './trend-chip.styles';
import { trendChipVariants } from './trend-chip.styles';

type TrendType = 'down' | 'neutral' | 'up';

type TrendChipContextValue = {
  slots: ReturnType<typeof trendChipVariants>;
};

const TrendChipContext = createContext<TrendChipContextValue>(
  {} as TrendChipContextValue
);

const TrendIcons: Record<
  TrendType,
  ((props: React.SVGProps<SVGSVGElement>) => React.ReactElement) | null
> = {
  down: (props) => (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M12 5v14m5-5-5 5-5-5" />
    </svg>
  ),
  neutral: null,
  up: (props) => (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M12 19V5m-5 5 5-5 5 5" />
    </svg>
  ),
};

const trendColorMap: Record<TrendType, 'danger' | 'default' | 'success'> = {
  down: 'danger',
  neutral: 'default',
  up: 'success',
};

interface TrendChipIndicatorProps extends ComponentPropsWithRef<'svg'> {
  children?: ReactNode;
  className?: string;
}

const TrendChipIndicator = ({
  children,
  className,
  ...props
}: TrendChipIndicatorProps): React.ReactElement<{
  className?: string;
  'data-slot'?: string;
}> | null => {
  const { slots } = useContext(TrendChipContext);
  if (!children) return null;
  if (React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<{
        className?: string;
        'data-slot'?: string;
      }>,
      {
        ...props,
        className: composeSlotClassName(slots?.indicator, className),
        'data-slot': 'trend-chip-indicator',
      }
    );
  }
  return null;
};

interface TrendChipPrefixProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const TrendChipPrefix = ({
  children,
  className,
  ...props
}: TrendChipPrefixProps) => {
  const { slots } = useContext(TrendChipContext);
  return (
    <span
      className={composeSlotClassName(slots?.prefix, className)}
      data-slot="trend-chip-prefix"
      {...props}
    >
      {children}
    </span>
  );
};

interface TrendChipSuffixProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const TrendChipSuffix = ({
  children,
  className,
  ...props
}: TrendChipSuffixProps) => {
  const { slots } = useContext(TrendChipContext);
  return (
    <span
      className={composeSlotClassName(slots?.suffix, className)}
      data-slot="trend-chip-suffix"
      {...props}
    >
      {children}
    </span>
  );
};

interface TrendChipRootProps extends Omit<
  ComponentPropsWithRef<typeof Chip>,
  'children' | 'color' | 'size' | 'variant'
> {
  children: ReactNode;
  size?: TrendChipVariants['size'];
  trend?: TrendType;
  variant?: 'primary' | 'secondary' | 'soft' | 'tertiary';
}

const TrendChipRoot = ({
  children,
  className,
  size,
  trend = 'up',
  variant = 'soft',
  ...props
}: TrendChipRootProps) => {
  const slots = useMemo(() => trendChipVariants({ size }), [size]);
  const chipColor = trendColorMap[trend];
  const resolvedSize = size ?? 'sm';

  let indicator: React.ReactElement | null = null;
  let prefix: React.ReactElement | null = null;
  let suffix: React.ReactElement | null = null;
  const content: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (child.type === TrendChipIndicator)
        indicator = child as React.ReactElement;
      else if (child.type === TrendChipPrefix)
        prefix = child as React.ReactElement;
      else if (child.type === TrendChipSuffix)
        suffix = child as React.ReactElement;
      else content.push(child);
    } else {
      content.push(child);
    }
  });

  const IconComponent = TrendIcons[trend];
  const resolvedIndicator =
    indicator ??
    (IconComponent ? (
      <IconComponent
        className={composeSlotClassName(slots?.indicator)}
        data-slot="trend-chip-indicator"
      />
    ) : null);

  return (
    <TrendChipContext.Provider value={{ slots }}>
      <Chip
        className={composeSlotClassName(slots?.base, className)}
        color={chipColor}
        data-slot="trend-chip"
        data-trend={trend}
        size={resolvedSize}
        variant={variant}
        {...props}
      >
        {resolvedIndicator}
        <Chip.Label>
          {prefix}{' '}
          <span className={slots?.value()} data-slot="trend-chip-value">
            {content}
          </span>{' '}
          {suffix}
        </Chip.Label>
      </Chip>
    </TrendChipContext.Provider>
  );
};

export { TrendChipIndicator, TrendChipPrefix, TrendChipRoot, TrendChipSuffix };
export type {
  TrendChipIndicatorProps,
  TrendChipPrefixProps,
  TrendChipRootProps,
  TrendChipSuffixProps,
};
