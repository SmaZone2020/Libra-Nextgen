'use client';

import type { Key } from 'react';
import { useDragAndDrop } from 'react-aria-components/useDragAndDrop';

/**
 * Minimal interface matching the subset of `useTreeData` return value
 * needed for drag-and-drop operations.
 */
export interface TreeDataManager {
  getItem(key: Key): { children?: unknown[] | null } | null | undefined;
  move(key: Key, toParentKey: Key | null, index: number): void;
  moveAfter(key: Key, keys: Iterable<Key>): void;
  moveBefore(key: Key, keys: Iterable<Key>): void;
}

export interface UseFileTreeDragOptions {
  /** The mutable tree data object returned by `useTreeData` from `react-aria-components`. */
  tree: TreeDataManager;
  /** Custom drag data per item. By default each key is serialized as `{ "text/plain": String(key) }`. */
  getItems?: Parameters<typeof useDragAndDrop>[0]['getItems'];
  /** Called after items are successfully moved within the tree. */
  onMove?: (keys: Set<Key>, target: { key: Key; dropPosition: string }) => void;
}

export function useFileTreeDrag({
  getItems,
  onMove: onMoveCallback,
  tree,
}: UseFileTreeDragOptions) {
  const { dragAndDropHooks } = useDragAndDrop({
    getItems:
      getItems ??
      ((keys) => [...keys].map((key) => ({ 'text/plain': String(key) }))),
    onMove(event) {
      if (event.target.dropPosition === 'before') {
        tree.moveBefore(event.target.key, event.keys);
      } else if (event.target.dropPosition === 'after') {
        tree.moveAfter(event.target.key, event.keys);
      } else if (event.target.dropPosition === 'on') {
        const parent = tree.getItem(event.target.key);
        if (parent) {
          const startIndex = parent.children ? parent.children.length : 0;
          const keys = [...event.keys];
          for (let i = 0; i < keys.length; i++) {
            tree.move(keys[i], event.target.key, startIndex + i);
          }
        }
      }
      onMoveCallback?.(event.keys, event.target);
    },
  });

  return { dragAndDropHooks };
}
