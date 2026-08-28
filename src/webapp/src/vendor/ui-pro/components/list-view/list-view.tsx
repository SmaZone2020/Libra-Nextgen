'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo, useRef } from 'react';
import { GridList, GridListItem } from 'react-aria-components/GridList';
import { ListLayout, Virtualizer } from 'react-aria-components/Virtualizer';
import { Checkbox } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { ListViewVariants } from './list-view.styles';
import { listViewVariants } from './list-view.styles';

interface ListViewContextValue {
  selectionMode?: string;
  slots?: ReturnType<typeof listViewVariants>;
  variant?: ListViewVariants['variant'];
}

const ListViewContext = createContext<ListViewContextValue>({});

interface ListViewRootProps<T extends object> extends Omit<
  ComponentPropsWithRef<typeof GridList<T>>,
  'layout' | 'orientation'
> {
  /** Visual variant. @default "primary" */
  variant?: ListViewVariants['variant'];
  /** Enable row virtualization for large datasets. @default false */
  virtualized?: boolean;
  /** Estimated row height in pixels for virtualization. @default 48 */
  rowHeight?: number;
  /** Render function for the empty state. */
  renderEmptyState?: () => ReactNode;
}

const ListViewRoot = <T extends object>({
  children,
  className,
  renderEmptyState,
  rowHeight = 48,
  selectionMode,
  variant = 'primary',
  virtualized = false,
  ...props
}: ListViewRootProps<T>) => {
  const slots = useMemo(() => listViewVariants({ variant }), [variant]);
  const ref = useRef<HTMLElement>(null);

  const emptyStateRenderer = renderEmptyState
    ? () => (
        <div
          className={composeSlotClassName(slots?.emptyState, undefined)}
          data-slot="list-view-empty-state"
        >
          {renderEmptyState()}
        </div>
      )
    : undefined;

  const list = (
    <GridList
      ref={ref as React.RefObject<HTMLDivElement>}
      className={composeTwRenderProps(className, slots?.base())}
      data-slot="list-view"
      data-virtualized={virtualized || undefined}
      renderEmptyState={emptyStateRenderer}
      selectionMode={selectionMode === 'none' ? undefined : selectionMode}
      {...props}
    >
      {children}
    </GridList>
  );

  return (
    <ListViewContext.Provider value={{ selectionMode, slots, variant }}>
      {virtualized ? (
        <Virtualizer
          layout={ListLayout}
          layoutOptions={{ estimatedRowHeight: rowHeight }}
        >
          {list}
        </Virtualizer>
      ) : (
        list
      )}
    </ListViewContext.Provider>
  );
};

interface ListViewItemProps<T extends object> extends Omit<
  ComponentPropsWithRef<typeof GridListItem<T>>,
  'children'
> {
  children: ReactNode;
}

const ListViewItem = <T extends object>({
  children,
  className,
  ...props
}: ListViewItemProps<T>) => {
  const { selectionMode, slots, variant } = useContext(ListViewContext);
  const checkboxVariant = variant === 'secondary' ? 'primary' : 'secondary';

  return (
    <GridListItem
      className={composeTwRenderProps(className, slots?.item())}
      data-slot="list-view-item"
      {...props}
    >
      {({ selectionBehavior, selectionMode: itemSelectionMode }) => (
        <>
          {selectionMode !== 'none' &&
            itemSelectionMode !== 'none' &&
            selectionBehavior === 'toggle' && (
              <div
                className={composeSlotClassName(
                  slots?.selectionCell,
                  undefined
                )}
                data-slot="list-view-selection-cell"
              >
                <Checkbox
                  aria-label="Select row"
                  slot="selection"
                  variant={checkboxVariant}
                >
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                </Checkbox>
              </div>
            )}
          {children}
        </>
      )}
    </GridListItem>
  );
};

interface ListViewItemContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const ListViewItemContent = ({
  children,
  className,
  ...props
}: ListViewItemContentProps) => {
  const { slots } = useContext(ListViewContext);

  return (
    <div
      className={composeSlotClassName(slots?.itemContent, className)}
      data-slot="list-view-item-content"
      {...props}
    >
      {children}
    </div>
  );
};

interface ListViewTitleProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const ListViewTitle = ({
  children,
  className,
  ...props
}: ListViewTitleProps) => {
  const { slots } = useContext(ListViewContext);

  return (
    <span
      className={composeSlotClassName(slots?.title, className)}
      data-slot="list-view-title"
      {...props}
    >
      {children}
    </span>
  );
};

interface ListViewDescriptionProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const ListViewDescription = ({
  children,
  className,
  ...props
}: ListViewDescriptionProps) => {
  const { slots } = useContext(ListViewContext);

  return (
    <span
      className={composeSlotClassName(slots?.description, className)}
      data-slot="list-view-description"
      {...props}
    >
      {children}
    </span>
  );
};

interface ListViewItemActionProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const ListViewItemAction = ({
  children,
  className,
  ...props
}: ListViewItemActionProps) => {
  const { slots } = useContext(ListViewContext);

  return (
    <div
      className={composeSlotClassName(slots?.itemAction, className)}
      data-slot="list-view-item-action"
      {...props}
    >
      {children}
    </div>
  );
};

export {
  ListViewDescription,
  ListViewItem,
  ListViewItemAction,
  ListViewItemContent,
  ListViewRoot,
  ListViewTitle,
};

export type {
  ListViewDescriptionProps,
  ListViewItemActionProps,
  ListViewItemContentProps,
  ListViewItemProps,
  ListViewRootProps,
  ListViewTitleProps,
};
