'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type { Key } from 'react-aria-components';
import {
  isTextDropItem,
  useDragAndDrop,
} from 'react-aria-components/useDragAndDrop';
import type { ListData } from 'react-aria-components/useListData';
import { useListData } from 'react-aria-components/useListData';

interface UseKanbanOptions<T extends object> {
  /** Items to populate the board with. */
  initialItems: T[];
  /** Return the column identifier for a given item. */
  getColumn: (item: T) => string;
  /** Return a copy of the item assigned to a new column. */
  setColumn: (item: T, column: string) => T;
  /** Custom MIME-like drag type used to transfer item keys between columns. @default "kanban-item-id" */
  dragType?: string;
  /** Derive a unique key from each item. Defaults to `item.id`. */
  getKey?: (item: T) => string | number;
}

interface UseKanbanReturn<T extends object> {
  /** The underlying ListData — use for advanced operations. */
  list: ListData<T>;
  /** Add an item to the board. It appears in the column determined by `getColumn`. */
  addItem: (item: T) => void;
  /** Remove an item by its key. */
  removeItem: (key: string | number) => void;
  /** Move an item to a different column by key. */
  moveItem: (key: string | number, toColumn: string) => void;
  /** Update an item by key with a partial or full replacement. */
  updateItem: (key: string | number, item: T) => void;
  getColumn: (item: T) => string;
  setColumn: (item: T, column: string) => T;
  dragType: string;
}

function useKanban<T extends object>(
  options: UseKanbanOptions<T>
): UseKanbanReturn<T> {
  const {
    dragType = 'kanban-item-id',
    getColumn,
    getKey,
    initialItems,
    setColumn,
  } = options;

  const list = useListData<T>({ getKey, initialItems });

  return {
    addItem: (item: T) => {
      list.append(item);
    },
    dragType,
    getColumn,
    list,
    moveItem: (key: string | number, toColumn: string) => {
      const item = list.getItem(key);

      if (item) {
        list.update(key, setColumn(item, toColumn));
      }
    },
    removeItem: (key: string | number) => {
      list.remove(key);
    },
    setColumn,
    updateItem: (key: string | number, item: T) => {
      list.update(key, item);
    },
  };
}

type UseDragAndDropOptions = Parameters<typeof useDragAndDrop>[0];
type RenderDropIndicatorFn = NonNullable<
  UseDragAndDropOptions['renderDropIndicator']
>;
type DropTarget = Parameters<RenderDropIndicatorFn>[0];

interface UseKanbanColumnOptions {
  /** Override the default drop indicator rendering. */
  renderDropIndicator?: UseDragAndDropOptions['renderDropIndicator'];
}

interface UseKanbanColumnReturn<T extends object> {
  /** Items that belong to this column. */
  items: T[];
  /** Drag-and-drop hooks to pass to `Kanban.CardList`. */
  dragAndDropHooks: ReturnType<typeof useDragAndDrop>['dragAndDropHooks'];
}

function useKanbanColumn<T extends object>(
  kanban: UseKanbanReturn<T>,
  column: string,
  options?: UseKanbanColumnOptions
): UseKanbanColumnReturn<T> {
  const { dragType, getColumn, list, setColumn } = kanban;

  const items = useMemo(
    () => list.items.filter((item) => getColumn(item) === column),
    [list.items, getColumn, column]
  );

  const { dragAndDropHooks } = useDragAndDrop({
    acceptedDragTypes: [dragType],
    getDropOperation: () => 'move',
    getItems: (keys) =>
      [...keys].map((key) => ({
        [dragType]: String(key),
        'text/plain': String(key),
      })),
    async onInsert(e) {
      const keys = await Promise.all(
        e.items.filter(isTextDropItem).map((item) => item.getText(dragType))
      );

      for (const key of keys) {
        const item = list.getItem(key);

        if (item) {
          list.update(key, setColumn(item, column));
        }
      }

      if (e.target.dropPosition === 'before') {
        list.moveBefore(e.target.key, items as unknown as Iterable<Key>);
      } else if (e.target.dropPosition === 'after') {
        list.moveAfter(e.target.key, items as unknown as Iterable<Key>);
      }
    },
    onReorder(e) {
      if (e.target.dropPosition === 'before') {
        list.moveBefore(e.target.key, e.keys);
      } else if (e.target.dropPosition === 'after') {
        list.moveAfter(e.target.key, e.keys);
      }
    },
    async onRootDrop(e) {
      const keys = await Promise.all(
        e.items.filter(isTextDropItem).map((item) => item.getText(dragType))
      );

      for (const key of keys) {
        const item = list.getItem(key);

        if (item) {
          list.update(key, setColumn(item, column));
        }
      }
    },
    renderDropIndicator: options?.renderDropIndicator,
  });

  return { dragAndDropHooks, items };
}

interface UseKanbanCardPlaceholderOptions {
  /** Render function that receives the drop target. Return your custom DropIndicator. */
  renderIndicator: (target: DropTarget) => React.JSX.Element;
}

interface UseKanbanCardPlaceholderReturn {
  /** Pass to `useKanbanColumn` options as `renderDropIndicator`. */
  renderDropIndicator: UseDragAndDropOptions['renderDropIndicator'];
}

function useKanbanCardPlaceholder(
  options: UseKanbanCardPlaceholderOptions
): UseKanbanCardPlaceholderReturn {
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dragging = document.querySelector('[data-dragging]');

      if (dragging) {
        const height = dragging.getBoundingClientRect().height;

        if (height > 0) {
          document.documentElement.style.setProperty(
            '--kanban-drop-height',
            `${height}px`
          );
        }
      } else {
        document.documentElement.style.removeProperty('--kanban-drop-height');
      }
    });

    observer.observe(document.body, {
      attributeFilter: ['data-dragging'],
      attributes: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--kanban-drop-height');
    };
  }, []);

  return {
    renderDropIndicator: useCallback(
      (target: DropTarget) => options.renderIndicator(target),
      [options]
    ),
  };
}

export { useKanban, useKanbanCardPlaceholder, useKanbanColumn };

export type {
  UseKanbanCardPlaceholderOptions,
  UseKanbanCardPlaceholderReturn,
  UseKanbanColumnOptions,
  UseKanbanColumnReturn,
  UseKanbanOptions,
  UseKanbanReturn,
};
