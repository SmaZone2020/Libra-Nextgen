'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Radio as RadioPrimitive,
  RadioGroup as RadioGroupPrimitive,
} from 'react-aria-components/RadioGroup';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { RatingVariants } from './rating.styles';
import { ratingVariants } from './rating.styles';

const RatingStarIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    aria-hidden="true"
    fill="currentColor"
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M6.886.773C7.29-.231 8.71-.231 9.114.773l1.472 3.667l3.943.268c1.08.073 1.518 1.424.688 2.118L12.185 9.36l.964 3.832c.264 1.05-.886 1.884-1.802 1.31L8 12.4l-3.347 2.101c-.916.575-2.066-.26-1.802-1.309l.964-3.832L.783 6.826c-.83-.694-.391-2.045.688-2.118l3.943-.268z" />
  </svg>
);

interface RatingContextValue {
  hoveredValue: number | null;
  icon?: ReactNode;
  isReadOnly: boolean;
  onItemHoverEnd: () => void;
  onItemHoverStart: (v: number) => void;
  slots: ReturnType<typeof ratingVariants>;
  value: number;
}

const RatingContext = createContext<RatingContextValue>({
  hoveredValue: null,
  onItemHoverEnd: () => {},
  onItemHoverStart: () => {},
  value: 0,
  isReadOnly: false,
  slots: {} as ReturnType<typeof ratingVariants>,
});

interface RatingRootProps
  extends
    Omit<
      ComponentPropsWithRef<typeof RadioGroupPrimitive>,
      'defaultValue' | 'onChange' | 'orientation' | 'value'
    >,
    RatingVariants {
  /** Default rating value (uncontrolled). */
  defaultValue?: number;
  /** Custom icon rendered for all items unless overridden per-item. */
  icon?: ReactNode;
  /** Callback fired when the selected rating changes. */
  onValueChange?: (value: number) => void;
  /** Controlled rating value. Supports fractional values in read-only mode (e.g. 3.5). */
  value?: number;
}

const RatingRoot = ({
  children,
  className,
  defaultValue,
  icon,
  isReadOnly,
  onValueChange,
  size = 'md',
  value: valueProp,
  ...props
}: RatingRootProps) => {
  const slots = useMemo(() => ratingVariants({ size }), [size]);
  const [hoveredValue, setHoveredValue] = useState<number | null>(null);
  const [internalValue, setInternalValue] = useState<number | undefined>(
    defaultValue
  );
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const value = valueProp ?? internalValue ?? 0;

  const onItemHoverStart = useCallback((v: number) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
    setHoveredValue(v);
  }, []);

  const onItemHoverEnd = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredValue(null);
    }, 50);
  }, []);

  const contextValue = useMemo(
    () => ({
      hoveredValue,
      icon,
      isReadOnly: isReadOnly || false,
      onItemHoverEnd,
      onItemHoverStart,
      slots,
      value,
    }),
    [
      hoveredValue,
      icon,
      isReadOnly,
      onItemHoverEnd,
      onItemHoverStart,
      slots,
      value,
    ]
  );

  return (
    <RatingContext.Provider value={contextValue}>
      <RadioGroupPrimitive
        isReadOnly={isReadOnly}
        orientation="horizontal"
        {...props}
        className={composeTwRenderProps(className, slots?.base())}
        data-readonly={isReadOnly || undefined}
        data-slot="rating"
        defaultValue={defaultValue != null ? String(defaultValue) : undefined}
        value={valueProp != null ? String(Math.floor(valueProp)) : undefined}
        onChange={(v) => {
          const num = Number(v);
          setInternalValue(num);
          onValueChange?.(num);
        }}
      >
        {(renderProps) => (
          <>
            {typeof children === 'function' ? children(renderProps) : children}
          </>
        )}
      </RadioGroupPrimitive>
    </RatingContext.Provider>
  );
};

interface RatingItemRenderProps {
  isActive: boolean;
  isPartial: boolean;
  partialPercent: number;
}

interface RatingItemProps extends Omit<
  ComponentPropsWithRef<typeof RadioPrimitive>,
  'children' | 'value'
> {
  /** Custom icon or render function. When a function, receives `{ isActive, isPartial, partialPercent }`. */
  children?: ReactNode | ((props: RatingItemRenderProps) => ReactNode);
  /** Numeric value for this rating item. */
  value: number;
}

const RatingItem = ({
  children,
  className,
  value: itemValue,
  ...props
}: RatingItemProps) => {
  const ctx = useContext(RatingContext);
  const numericValue = itemValue;
  const isActive =
    ctx.hoveredValue !== null
      ? numericValue <= ctx.hoveredValue
      : numericValue <= Math.floor(ctx.value);
  const partialPercent =
    !isActive &&
    ctx.isReadOnly &&
    ctx.hoveredValue === null &&
    numericValue - 1 < ctx.value &&
    ctx.value < numericValue
      ? Math.round(100 * (ctx.value - (numericValue - 1)))
      : null;
  const isPartial = partialPercent !== null;

  if (typeof children === 'function') {
    return (
      <RadioPrimitive
        aria-label={`${itemValue} star${itemValue !== 1 ? 's' : ''}`}
        {...props}
        className={composeTwRenderProps(className, ctx.slots?.item())}
        data-active={isActive || undefined}
        data-readonly={ctx.isReadOnly || undefined}
        data-slot="rating-item"
        value={String(itemValue)}
        onHoverEnd={(e) => {
          ctx.onItemHoverEnd();
          props.onHoverEnd?.(e);
        }}
        onHoverStart={(e) => {
          ctx.onItemHoverStart(numericValue);
          props.onHoverStart?.(e);
        }}
      >
        {children({
          isActive: isActive || isPartial,
          isPartial,
          partialPercent: partialPercent || 0,
        })}
      </RadioPrimitive>
    );
  }

  const icon = children ?? ctx.icon ?? <RatingStarIcon />;

  return (
    <RadioPrimitive
      aria-label={`${itemValue} star${itemValue !== 1 ? 's' : ''}`}
      {...props}
      className={composeTwRenderProps(className, ctx.slots?.item())}
      data-active={isActive || undefined}
      data-readonly={ctx.isReadOnly || undefined}
      data-slot="rating-item"
      value={String(itemValue)}
      onHoverEnd={(e) => {
        ctx.onItemHoverEnd();
        props.onHoverEnd?.(e);
      }}
      onHoverStart={(e) => {
        ctx.onItemHoverStart(numericValue);
        props.onHoverStart?.(e);
      }}
    >
      <span
        className={composeSlotClassName(ctx.slots?.icon)}
        data-slot="rating-icon"
      >
        {icon}
      </span>
      {isPartial && (
        <span
          className={composeSlotClassName(ctx.slots?.iconPartial)}
          data-slot="rating-icon-partial"
          style={
            { '--rating-partial': `${partialPercent}%` } as React.CSSProperties
          }
        >
          {icon}
        </span>
      )}
    </RadioPrimitive>
  );
};

export { RatingItem, RatingRoot, RatingStarIcon };
export type { RatingItemProps, RatingItemRenderProps, RatingRootProps };
