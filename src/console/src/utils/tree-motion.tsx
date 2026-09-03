'use client';

import React, {
  cloneElement,
  isValidElement,
  type Key,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import {
  CollectionRendererContext,
  DefaultCollectionRenderer,
} from 'react-aria-components/CollectionBuilder';
import {
  AnimatePresence,
  domMax,
  LazyMotion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react';
import * as m from 'motion/react-m';

interface TreeMotionProviderProps {
  children: ReactNode;
  reduceMotion?: boolean;
}

const treeVariants = {
  enter: {
    height: 'auto',
    opacity: 1,
    overflow: 'hidden',
    transition: {
      height: { bounce: 0, duration: 0.24, type: 'spring' },
      opacity: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
    },
    transitionEnd: { overflow: 'visible' },
  },
  exit: {
    height: 0,
    opacity: 0,
    overflow: 'hidden',
    transition: {
      height: { duration: 0.18, ease: [0.4, 0, 1, 1] },
      opacity: { duration: 0.1, ease: [0.23, 1, 0.32, 1] },
    },
  },
};

function renderChild(child: unknown, key: Key): React.ReactElement | null {
  if (child == null || typeof child === 'boolean') return null;
  if (isValidElement(child))
    return cloneElement(child as React.ReactElement, { key });
  return jsx(React.Fragment, { children: child }, key);
}

function renderCustom(
  renderFn: ((node: unknown) => ReactNode) | undefined,
  node: unknown,
  key: Key
): React.ReactElement | null {
  return renderFn ? renderChild(renderFn(node), key) : null;
}

function getChildNodes(collection: any, parent: any) {
  return Array.from(
    parent ? collection.getChildren(parent.key) : collection
  ).filter(
    (node: any) =>
      node.type !== 'content' && node.parentKey === (parent?.key ?? null)
  );
}

function renderNode(
  collection: any,
  node: any,
  renderDropIndicator: ((args: any) => ReactNode) | undefined
): React.ReactElement | null {
  if (node.type === 'item') {
    return jsx(
      CollectionItemWithChildren,
      { collection, node, renderDropIndicator },
      node.key
    );
  }
  return renderChild(node.render?.(node), node.key);
}

function CollectionBranch({
  collection,
  parent,
  renderDropIndicator,
}: {
  collection: any;
  parent: any;
  renderDropIndicator?: (args: any) => ReactNode;
}) {
  return getChildNodes(collection, parent).map((node: any) =>
    renderNode(collection, node, renderDropIndicator)
  );
}

const animatedRenderers = {
  CollectionBranch: ({ collection, parent, renderDropIndicator }: any) =>
    jsx(CollectionBranch, { collection, parent, renderDropIndicator }),
  CollectionRoot: ({ collection, renderDropIndicator }: any) =>
    jsx(CollectionBranch, { collection, parent: null, renderDropIndicator }),
};

function getNextSiblingItem(collection: any, node: any) {
  let nextKey = collection.getKeyAfter(node.key);
  let next = nextKey != null ? collection.getItem(nextKey) : null;
  while (next && next.type === 'content') {
    nextKey = collection.getKeyAfter(next.key);
    next = nextKey != null ? collection.getItem(nextKey) : null;
  }
  return next?.parentKey === node.key ? next : null;
}

function getNextSiblingOfSameParent(collection: any, node: any) {
  let next = node.nextKey != null ? collection.getItem(node.nextKey) : null;
  while (next && next.type !== 'item') {
    next = next.nextKey != null ? collection.getItem(next.nextKey) : null;
  }
  return next;
}

function CollectionItemWithChildren({
  collection,
  node,
  renderDropIndicator,
}: {
  collection: any;
  node: any;
  renderDropIndicator?: (args: any) => ReactNode;
}) {
  const rendered = node.render?.(node);
  if (rendered == null || typeof rendered === 'boolean') return null;

  const childNodes = getChildNodes(collection, node);
  const hasExpandedChildren =
    childNodes.length > 0 && getNextSiblingItem(collection, node) != null;
  const isLast = getNextSiblingOfSameParent(collection, node) == null;

  const beforeIndicator = renderCustom(
    renderDropIndicator,
    { dropPosition: 'before', key: node.key, type: 'item' },
    `${String(node.key)}-before`
  );
  const afterIndicator = isLast
    ? renderCustom(
        renderDropIndicator,
        { dropPosition: 'after', key: node.key, type: 'item' },
        `${String(node.key)}-after`
      )
    : null;

  return jsxs(
    React.Fragment,
    {
      children: [
        beforeIndicator,
        rendered,
        childNodes.length > 0
          ? jsx(AnimatePresence, {
              initial: false,
              children: hasExpandedChildren
                ? jsx(
                    AnimatedChildren,
                    {
                      childNodes,
                      collection,
                      renderDropIndicator,
                    },
                    `${String(node.key)}-children`
                  )
                : null,
            })
          : null,
        afterIndicator,
      ],
    },
    node.key
  );
}

function AnimatedChildren({
  childNodes,
  collection,
  renderDropIndicator,
}: {
  childNodes: any[];
  collection: any;
  renderDropIndicator?: (args: any) => ReactNode;
}) {
  const isPresent = useIsPresent();

  return jsx(m.div, {
    animate: 'enter',
    'aria-hidden': !isPresent || undefined,
    'data-tree-motion-section': '',
    exit: 'exit',
    initial: 'exit',
    role: 'presentation',
    variants: treeVariants,
    style: { pointerEvents: isPresent ? undefined : 'none' },
    children: childNodes.map((node: any) =>
      renderNode(collection, node, renderDropIndicator)
    ),
  });
}

export const TreeMotionProvider = ({
  children,
  reduceMotion = false,
}: TreeMotionProviderProps) => {
  const parentRenderer =
    useContext(CollectionRendererContext) ?? DefaultCollectionRenderer;
  const prefersReducedMotion = useReducedMotion();
  const useAnimation = !(
    reduceMotion ||
    prefersReducedMotion ||
    parentRenderer.isVirtualized
  );
  const renderer = useMemo(
    () =>
      useAnimation
        ? { ...parentRenderer, ...animatedRenderers }
        : parentRenderer,
    [parentRenderer, useAnimation]
  );

  return jsx(CollectionRendererContext, {
    value: renderer,
    children: jsx(LazyMotion, { features: domMax, children }),
  });
};
