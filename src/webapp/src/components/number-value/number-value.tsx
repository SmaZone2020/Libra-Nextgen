'use client';

import React, {
  type ComponentPropsWithRef,
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useLocale } from 'react-aria-components/I18nProvider';
import type { NumberFormatOptions } from '@internationalized/number';
import { NumberFormatter } from '@internationalized/number';
import { composeSlotClassName } from '../../utils/compose';
import { numberValueVariants } from './number-value.styles';

type NumberValueContextValue = {
  slots?: ReturnType<typeof numberValueVariants>;
};

const NumberValueContext = createContext<NumberValueContextValue>({});

export interface NumberValuePrefixProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

export const NumberValuePrefix = ({
  children,
  className,
  ...props
}: NumberValuePrefixProps) => {
  const { slots } = useContext(NumberValueContext);
  return jsx('span', {
    className: composeSlotClassName(slots?.prefix, className),
    'data-slot': 'number-value-prefix',
    ...props,
    children,
  });
};

export interface NumberValueSuffixProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

export const NumberValueSuffix = ({
  children,
  className,
  ...props
}: NumberValueSuffixProps) => {
  const { slots } = useContext(NumberValueContext);
  return jsx('span', {
    className: composeSlotClassName(slots?.suffix, className),
    'data-slot': 'number-value-suffix',
    ...props,
    children,
  });
};

export interface NumberValueRootProps extends Omit<
  ComponentPropsWithRef<'span'>,
  'children' | 'style'
> {
  /** Render prop receiving the formatted string, or ReactNode children (Prefix/Suffix). */
  children?: ((formatted: string) => ReactNode) | ReactNode;
  /** Currency code (e.g. "USD"). Required when style is "currency". */
  currency?: string;
  /** Format options. Overrides individual props. */
  formatOptions?: NumberFormatOptions;
  /** Override locale from I18nProvider. */
  locale?: string;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  /** @default "standard" */
  notation?: 'compact' | 'engineering' | 'scientific' | 'standard';
  signDisplay?: 'always' | 'auto' | 'exceptZero' | 'never';
  /** @default "decimal" */
  style?: 'currency' | 'decimal' | 'percent' | 'unit';
  unit?: string;
  value: number;
}

export const NumberValueRoot = ({
  children,
  className,
  currency,
  formatOptions,
  locale: localeProp,
  maximumFractionDigits,
  minimumFractionDigits,
  notation,
  signDisplay,
  style,
  unit,
  value,
  ...props
}: NumberValueRootProps) => {
  const { locale: i18nLocale } = useLocale();
  const resolvedLocale = localeProp ?? i18nLocale;

  const slots = useMemo(() => numberValueVariants(), []);

  const resolvedFormatOptions = useMemo<NumberFormatOptions>(
    () =>
      formatOptions ?? {
        ...(currency != null && { currency }),
        ...(maximumFractionDigits != null && { maximumFractionDigits }),
        ...(minimumFractionDigits != null && { minimumFractionDigits }),
        ...(notation != null && { notation }),
        ...(signDisplay != null && { signDisplay }),
        ...(style != null && { style }),
        ...(unit != null && { unit }),
      },
    [
      formatOptions,
      currency,
      maximumFractionDigits,
      minimumFractionDigits,
      notation,
      signDisplay,
      style,
      unit,
    ]
  );

  const formatted = useMemo(
    () =>
      new NumberFormatter(resolvedLocale, resolvedFormatOptions).format(value),
    [resolvedLocale, resolvedFormatOptions, value]
  );

  if (typeof children === 'function') {
    return jsx(NumberValueContext, {
      value: { slots },
      children: (children as (f: string) => ReactNode)(formatted),
    });
  }

  let prefix: ReactNode = null;
  let suffix: ReactNode = null;
  const rest: ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (child.type === NumberValuePrefix) {
        prefix = child;
      } else if (child.type === NumberValueSuffix) {
        suffix = child;
      } else {
        rest.push(child);
      }
    } else {
      rest.push(child);
    }
  });

  return jsx(NumberValueContext, {
    value: { slots },
    children: jsxs('span', {
      className: composeSlotClassName(slots?.base, className),
      'data-slot': 'number-value',
      ...props,
      children: [
        prefix,
        jsx('span', {
          className: slots?.value(),
          'data-slot': 'number-value-value',
          children: formatted,
        }),
        suffix,
        ...rest,
      ],
    }),
  });
};
