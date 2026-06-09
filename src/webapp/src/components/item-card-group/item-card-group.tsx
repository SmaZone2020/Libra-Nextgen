'use client';

import type { ComponentPropsWithRef, CSSProperties, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import type { ItemCardGroupVariants } from './item-card-group.styles';
import { itemCardGroupVariants } from './item-card-group.styles';

interface ItemCardGroupContextValue {
  slots?: ReturnType<typeof itemCardGroupVariants>;
}

const ItemCardGroupContext = createContext<ItemCardGroupContextValue>({});

interface ItemCardGroupRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Number of grid columns when layout is "grid". @default 2 */
  columns?: 2 | 3;
  /** Layout mode. @default "list" */
  layout?: ItemCardGroupVariants['layout'];
  /** Visual variant. @default "default" */
  variant?: ItemCardGroupVariants['variant'];
}

const ItemCardGroupRoot = ({
  children,
  className,
  columns,
  layout,
  style,
  variant,
  ...props
}: ItemCardGroupRootProps) => {
  const slots = useMemo(
    () => itemCardGroupVariants({ layout, variant }),
    [layout, variant]
  );

  const resolvedStyle: CSSProperties | undefined =
    layout === 'grid' && columns
      ? ({ ...style, '--item-card-group-columns': columns } as CSSProperties)
      : style;

  return (
    <ItemCardGroupContext.Provider value={{ slots }}>
      <div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="item-card-group"
        role="group"
        style={resolvedStyle}
        {...props}
      >
        {children}
      </div>
    </ItemCardGroupContext.Provider>
  );
};

interface ItemCardGroupHeaderProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const ItemCardGroupHeader = ({
  children,
  className,
  ...props
}: ItemCardGroupHeaderProps) => {
  const { slots } = useContext(ItemCardGroupContext);

  return (
    <div
      className={composeSlotClassName(slots?.header, className)}
      data-slot="item-card-group-header"
      {...props}
    >
      {children}
    </div>
  );
};

interface ItemCardGroupTitleProps extends ComponentPropsWithRef<'h3'> {
  children: ReactNode;
}

const ItemCardGroupTitle = ({
  children,
  className,
  ...props
}: ItemCardGroupTitleProps) => {
  const { slots } = useContext(ItemCardGroupContext);

  return (
    <h3
      className={composeSlotClassName(slots?.title, className)}
      data-slot="item-card-group-title"
      {...props}
    >
      {children}
    </h3>
  );
};

interface ItemCardGroupDescriptionProps extends ComponentPropsWithRef<'p'> {
  children: ReactNode;
}

const ItemCardGroupDescription = ({
  children,
  className,
  ...props
}: ItemCardGroupDescriptionProps) => {
  const { slots } = useContext(ItemCardGroupContext);

  return (
    <p
      className={composeSlotClassName(slots?.description, className)}
      data-slot="item-card-group-description"
      {...props}
    >
      {children}
    </p>
  );
};

export {
  ItemCardGroupDescription,
  ItemCardGroupHeader,
  ItemCardGroupRoot,
  ItemCardGroupTitle,
};

export type {
  ItemCardGroupDescriptionProps,
  ItemCardGroupHeaderProps,
  ItemCardGroupRootProps,
  ItemCardGroupTitleProps,
};
