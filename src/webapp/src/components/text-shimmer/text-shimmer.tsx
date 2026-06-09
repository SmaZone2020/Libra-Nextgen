'use client';

import type { ReactNode } from 'react';
import React from 'react';
import { useMemo } from 'react';
import { dom } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import { textShimmerVariants } from './text-shimmer.styles';

interface TextShimmerProps<
  E extends keyof React.JSX.IntrinsicElements = 'span',
> {
  children: ReactNode;
  className?: string;
  as?: E;
}

const TextShimmer = <E extends keyof React.JSX.IntrinsicElements = 'span'>({
  children,
  className,
  ...props
}: TextShimmerProps<E> &
  Omit<React.JSX.IntrinsicElements[E], keyof TextShimmerProps<E>>) => {
  const slots = useMemo(() => textShimmerVariants(), []);
  return (
    <dom.span
      className={composeSlotClassName(slots?.base, className)}
      data-slot="text-shimmer"
      {...(props as object)}
    >
      {children}
    </dom.span>
  );
};

export { TextShimmer };
export type { TextShimmerProps };
