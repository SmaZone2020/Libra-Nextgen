'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { AnimatePresence, domAnimation, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import type { ToolbarProps } from '@heroui/react';
import { Toolbar } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import { actionBarVariants } from './action-bar.styles';

interface ActionBarRootProps extends Omit<ToolbarProps, 'children'> {
  children: ReactNode;
  /** Controls visibility with animated enter/exit. */
  isOpen: boolean;
}

interface ActionBarPrefixProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

interface ActionBarContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

interface ActionBarSuffixProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

interface ActionBarContextValue {
  slots?: ReturnType<typeof actionBarVariants>;
}

const ActionBarContext = createContext<ActionBarContextValue>({});

const ActionBarRoot = ({
  'aria-label': ariaLabel = 'Actions',
  children,
  className,
  isAttached = true,
  isOpen,
  orientation,
  ...props
}: ActionBarRootProps) => {
  const slots = useMemo(() => actionBarVariants({}), []);

  return (
    <ActionBarContext.Provider value={{ slots }}>
      <LazyMotion features={domAnimation}>
        <AnimatePresence>
          {!!isOpen && (
            <m.div
              animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
              className={composeSlotClassName(slots?.base)}
              data-slot="action-bar"
              exit={{ filter: 'blur(4px)', opacity: 0, y: 8 }}
              initial={{ filter: 'blur(4px)', opacity: 0, y: 8 }}
              transition={{ bounce: 0, duration: 0.3, type: 'spring' }}
            >
              <Toolbar
                aria-label={ariaLabel}
                className={composeSlotClassName(
                  slots?.wrapper,
                  className as string | undefined
                )}
                isAttached={isAttached}
                orientation={orientation}
                {...props}
              >
                {children}
              </Toolbar>
            </m.div>
          )}
        </AnimatePresence>
      </LazyMotion>
    </ActionBarContext.Provider>
  );
};

const ActionBarPrefix = ({
  children,
  className,
  ...props
}: ActionBarPrefixProps) => {
  const { slots } = useContext(ActionBarContext);
  return (
    <div
      className={composeSlotClassName(slots?.prefix, className)}
      data-slot="action-bar-prefix"
      {...props}
    >
      {children}
    </div>
  );
};

const ActionBarContent = ({
  children,
  className,
  ...props
}: ActionBarContentProps) => {
  const { slots } = useContext(ActionBarContext);
  return (
    <div
      className={composeSlotClassName(slots?.content, className)}
      data-slot="action-bar-content"
      {...props}
    >
      {children}
    </div>
  );
};

const ActionBarSuffix = ({
  children,
  className,
  ...props
}: ActionBarSuffixProps) => {
  const { slots } = useContext(ActionBarContext);
  return (
    <div
      className={composeSlotClassName(slots?.suffix, className)}
      data-slot="action-bar-suffix"
      {...props}
    >
      {children}
    </div>
  );
};

export { ActionBarContent, ActionBarPrefix, ActionBarRoot, ActionBarSuffix };
export type {
  ActionBarContentProps,
  ActionBarPrefixProps,
  ActionBarRootProps,
  ActionBarSuffixProps,
};
