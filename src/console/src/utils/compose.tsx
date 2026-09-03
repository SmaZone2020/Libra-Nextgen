'use client';

import { composeRenderProps } from 'react-aria-components/composeRenderProps';
import { cx } from 'tailwind-variants';

type ClassNameFn<T> = (value: T) => string | undefined;

export function composeTwRenderProps<T>(
  className: string | ClassNameFn<T> | undefined,
  tailwind?: string | ClassNameFn<T>
): string | ((value: T) => string) {
  const wrapped = composeRenderProps(
    className as string | undefined,
    (renderClassName, renderValues: T): string => {
      const base =
        typeof tailwind === 'function'
          ? (tailwind(renderValues) ?? '')
          : (tailwind ?? '');
      return (cx(base, renderClassName ?? '') ?? '') as string;
    }
  );
  return wrapped as string | ((value: T) => string);
}

export function composeSlotClassName(
  slotFn:
    | ((args?: { className?: string; [key: string]: unknown }) => string)
    | undefined,
  className?: string,
  variants?: Record<string, unknown>
): string | undefined {
  if (typeof slotFn === 'function') {
    return slotFn({ ...variants, className });
  }
  return className;
}
