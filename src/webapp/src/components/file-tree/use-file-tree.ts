'use client';

import { useCallback, useMemo } from 'react';

interface TreeNode {
  id: string;
  children?: TreeNode[];
}

interface UseFileTreeOptions<T extends TreeNode> {
  /** The tree data. */
  items: T[];
  /** Return true for leaf nodes. Defaults to checking `!children || children.length === 0`. */
  isLeaf?: (node: T) => boolean;
}

interface UseFileTreeReturn<T extends TreeNode> {
  /** All expandable (branch) node keys — useful for `defaultExpandedKeys`. */
  expandableKeys: string[];
  /** Filter the tree by a leaf predicate. Prunes empty branches automatically. */
  filterTree: (predicate: (node: T) => boolean) => T[];
  /** All leaf nodes flattened from the tree. */
  leaves: T[];
}

function flattenLeaves<T extends TreeNode>(
  items: T[],
  isLeaf: (node: T) => boolean
): T[] {
  const result: T[] = [];
  for (const item of items) {
    if (isLeaf(item)) result.push(item);
    if (item.children)
      result.push(...flattenLeaves(item.children as T[], isLeaf));
  }
  return result;
}

function collectExpandableKeys<T extends TreeNode>(items: T[]): string[] {
  const keys: string[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      keys.push(item.id);
      keys.push(...collectExpandableKeys(item.children as T[]));
    }
  }
  return keys;
}

function filterTree<T extends TreeNode>(
  items: T[],
  predicate: (node: T) => boolean,
  isLeaf: (node: T) => boolean
): T[] {
  return items
    .map((item) => {
      if (isLeaf(item)) return predicate(item) ? item : null;
      if (item.children) {
        const filtered = filterTree(item.children as T[], predicate, isLeaf);
        if (filtered.length > 0) return { ...item, children: filtered };
      }
      return null;
    })
    .filter((x): x is T => x !== null);
}

const defaultIsLeaf = <T extends TreeNode>(node: T): boolean =>
  !node.children || node.children.length === 0;

export function useFileTree<T extends TreeNode>({
  isLeaf = defaultIsLeaf,
  items,
}: UseFileTreeOptions<T>): UseFileTreeReturn<T> {
  const leaves = useMemo(() => flattenLeaves(items, isLeaf), [items, isLeaf]);

  return {
    expandableKeys: useMemo(() => collectExpandableKeys(items), [items]),
    filterTree: useCallback(
      (predicate) => filterTree(items, predicate, isLeaf),
      [items, isLeaf]
    ),
    leaves,
  };
}

export type { TreeNode, UseFileTreeOptions, UseFileTreeReturn };
