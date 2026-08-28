'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Button, Disclosure } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { TextShimmer } from '../text-shimmer/text-shimmer';
import { chainOfThoughtVariants } from './chain-of-thought.styles';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChainOfThoughtRootProps extends ComponentPropsWithRef<
  typeof Disclosure
> {
  children: ReactNode;
  /** Show shimmer styling on the trigger while reasoning is in progress. */
  isStreaming?: boolean;
}

export interface ChainOfThoughtTriggerProps extends ComponentPropsWithRef<
  typeof Button
> {
  children: ReactNode;
}

export interface ChainOfThoughtContentProps extends ComponentPropsWithRef<
  typeof Disclosure.Content
> {
  children: ReactNode;
}

export interface ChainOfThoughtStepsProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChainOfThoughtStepProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  label?: ReactNode;
}

export type ChainOfThoughtProps = ChainOfThoughtRootProps;

// ── Context ──────────────────────────────────────────────────────────────────

interface ChainOfThoughtContextValue {
  isStreaming?: boolean;
  slots?: ReturnType<typeof chainOfThoughtVariants>;
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue>({});

function useSlots(): ReturnType<typeof chainOfThoughtVariants> {
  const { isStreaming, slots } = useContext(ChainOfThoughtContext);
  const computed = useMemo(
    () =>
      chainOfThoughtVariants({
        status: isStreaming ? 'streaming' : 'complete',
      }),
    [isStreaming]
  );
  return slots ?? computed;
}

// ── Components ───────────────────────────────────────────────────────────────

export const ChainOfThoughtRoot = ({
  children,
  className,
  isStreaming = false,
  ...props
}: ChainOfThoughtRootProps) => {
  const slots = useMemo(
    () =>
      chainOfThoughtVariants({
        status: isStreaming ? 'streaming' : 'complete',
      }),
    [isStreaming]
  );

  return (
    <ChainOfThoughtContext value={{ isStreaming, slots }}>
      <Disclosure
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="chain-of-thought"
        {...props}
      >
        {children}
      </Disclosure>
    </ChainOfThoughtContext>
  );
};

export const ChainOfThoughtTrigger = ({
  children,
  className,
  ...props
}: ChainOfThoughtTriggerProps) => {
  const { isStreaming } = useContext(ChainOfThoughtContext);
  const slots = useSlots();
  const content = isStreaming ? (
    <TextShimmer>{children}</TextShimmer>
  ) : (
    children
  );

  return (
    <Disclosure.Heading>
      <Button
        className={composeTwRenderProps(className, slots?.trigger())}
        data-slot="chain-of-thought-trigger"
        slot="trigger"
        variant="ghost"
        size="sm"
        {...props}
      >
        {content}
        <Disclosure.Indicator className="text-muted size-3.5" />
      </Button>
    </Disclosure.Heading>
  );
};

export const ChainOfThoughtContent = ({
  children,
  className,
  ...props
}: ChainOfThoughtContentProps) => {
  const slots = useSlots();

  return (
    <Disclosure.Content
      className={composeTwRenderProps(className, slots?.content())}
      data-slot="chain-of-thought-content"
      {...props}
    >
      <Disclosure.Body>{children}</Disclosure.Body>
    </Disclosure.Content>
  );
};

export const ChainOfThoughtSteps = ({
  children,
  className,
  ...props
}: ChainOfThoughtStepsProps) => {
  const slots = useSlots();

  return (
    <div
      className={composeSlotClassName(slots?.steps, className)}
      data-slot="chain-of-thought-steps"
      {...props}
    >
      {children}
    </div>
  );
};

export const ChainOfThoughtStep = ({
  children,
  className,
  label,
  ...props
}: ChainOfThoughtStepProps) => {
  const slots = useSlots();

  return (
    <div
      className={composeSlotClassName(slots?.step, className)}
      data-slot="chain-of-thought-step"
      {...props}
    >
      {label ? (
        <div className={composeSlotClassName(slots?.stepHeader, undefined)}>
          <span
            aria-hidden="true"
            className={composeSlotClassName(slots?.stepIndicator, undefined)}
          />
          <span className={composeSlotClassName(slots?.stepLabel, undefined)}>
            {label}
          </span>
        </div>
      ) : null}
      <div className={composeSlotClassName(slots?.stepContent, undefined)}>
        {children}
      </div>
    </div>
  );
};
