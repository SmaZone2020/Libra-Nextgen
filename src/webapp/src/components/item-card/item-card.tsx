'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { DOMRenderProps } from '@heroui/react';
import { dom } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import type { ItemCardVariants } from './item-card.styles';
import { itemCardVariants } from './item-card.styles';

interface ItemCardContextValue {
  slots?: ReturnType<typeof itemCardVariants>;
}

const ItemCardContext = createContext<ItemCardContextValue>({});

interface ItemCardRootProps<
  E extends keyof React.JSX.IntrinsicElements = 'div',
> extends DOMRenderProps<E, undefined> {
  children: ReactNode;
  className?: string;
  /** Visual variant. @default "default" */
  variant?: ItemCardVariants['variant'];
}

const ItemCardRoot = <E extends keyof React.JSX.IntrinsicElements = 'div'>({
  children,
  className,
  variant = 'default',
  ...props
}: ItemCardRootProps<E> &
  Omit<React.JSX.IntrinsicElements[E], keyof ItemCardRootProps<E>>) => {
  const slots = useMemo(() => itemCardVariants({ variant }), [variant]);

  return (
    <ItemCardContext.Provider value={{ slots }}>
      <dom.div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="item-card"
        {...(props as unknown as React.ComponentPropsWithRef<'div'>)}
      >
        {children}
      </dom.div>
    </ItemCardContext.Provider>
  );
};

interface ItemCardIconProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const ItemCardIcon = ({ children, className, ...props }: ItemCardIconProps) => {
  const { slots } = useContext(ItemCardContext);

  return (
    <div
      className={composeSlotClassName(slots?.icon, className)}
      data-slot="item-card-icon"
      {...props}
    >
      {children}
    </div>
  );
};

interface ItemCardContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const ItemCardContent = ({
  children,
  className,
  ...props
}: ItemCardContentProps) => {
  const { slots } = useContext(ItemCardContext);

  return (
    <div
      className={composeSlotClassName(slots?.content, className)}
      data-slot="item-card-content"
      {...props}
    >
      {children}
    </div>
  );
};

interface ItemCardTitleProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const ItemCardTitle = ({
  children,
  className,
  ...props
}: ItemCardTitleProps) => {
  const { slots } = useContext(ItemCardContext);

  return (
    <span
      className={composeSlotClassName(slots?.title, className)}
      data-slot="item-card-title"
      {...props}
    >
      {children}
    </span>
  );
};

interface ItemCardDescriptionProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const ItemCardDescription = ({
  children,
  className,
  ...props
}: ItemCardDescriptionProps) => {
  const { slots } = useContext(ItemCardContext);

  return (
    <span
      className={composeSlotClassName(slots?.description, className)}
      data-slot="item-card-description"
      {...props}
    >
      {children}
    </span>
  );
};

interface ItemCardActionProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const ItemCardAction = ({
  children,
  className,
  ...props
}: ItemCardActionProps) => {
  const { slots } = useContext(ItemCardContext);

  return (
    <div
      className={composeSlotClassName(slots?.action, className)}
      data-slot="item-card-action"
      {...props}
    >
      {children}
    </div>
  );
};

export {
  ItemCardAction,
  ItemCardContent,
  ItemCardDescription,
  ItemCardIcon,
  ItemCardRoot,
  ItemCardTitle,
};

export type {
  ItemCardActionProps,
  ItemCardContentProps,
  ItemCardDescriptionProps,
  ItemCardIconProps,
  ItemCardRootProps,
  ItemCardTitleProps,
};
