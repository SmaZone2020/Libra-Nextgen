'use client';

import type { ComponentPropsWithRef } from 'react';
import React from 'react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';
import type {
  GroupImperativeHandle,
  Layout,
  LayoutStorage,
  PanelImperativeHandle,
  PanelSize,
} from 'react-resizable-panels';
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels';
import { composeSlotClassName } from '../../utils/compose';
import { Grip, GripHorizontal } from '../icons';
import type { ResizableVariants } from './resizable.styles';
import { resizableVariants } from './resizable.styles';

const noopStorage: LayoutStorage = {
  getItem: () => null,
  setItem: () => {},
};

const localStorageImpl: LayoutStorage = {
  getItem: (key) => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* empty */
    }
  },
};

function normalizePanelSize(
  size: number | string | undefined
): string | undefined {
  if (size == null) return undefined;
  return typeof size === 'number' ? `${size}%` : size;
}

type ResizableContextValue = {
  orientation: NonNullable<ResizableVariants['orientation']>;
  slots: ReturnType<typeof resizableVariants>;
};

const ResizableContext = createContext<ResizableContextValue | null>(null);

const useResizableContext = (): ResizableContextValue => {
  const ctx = useContext(ResizableContext);
  if (!ctx) {
    throw new Error(
      'Resizable subcomponents must be rendered inside <Resizable>.'
    );
  }
  return ctx;
};

interface ResizableRootProps extends Omit<ComponentPropsWithRef<'div'>, 'id'> {
  autoSaveId?: string;
  children: ReactNode;
  handleRef?: React.Ref<GroupImperativeHandle>;
  id?: string;
  onLayoutChange?: (layout: Layout) => void;
  orientation?: ResizableVariants['orientation'];
  storage?: LayoutStorage;
}

const ResizableRoot = ({
  autoSaveId,
  children,
  className,
  handleRef,
  id,
  onLayoutChange,
  orientation = 'horizontal',
  storage,
  style,
  ...props
}: ResizableRootProps) => {
  const slots = useMemo(
    () => resizableVariants({ orientation }),
    [orientation]
  );
  const ctxValue = useMemo(
    () => ({ orientation: orientation ?? 'horizontal', slots }),
    [orientation, slots]
  );
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: autoSaveId || '__no_persist__',
    storage: autoSaveId ? (storage ?? localStorageImpl) : noopStorage,
  });

  return (
    <ResizableContext.Provider value={ctxValue}>
      <Group
        className={composeSlotClassName(slots?.base, className)}
        data-slot="resizable"
        defaultLayout={autoSaveId ? defaultLayout : undefined}
        groupRef={handleRef}
        id={id}
        orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
        style={style}
        onLayoutChange={onLayoutChange}
        onLayoutChanged={autoSaveId ? onLayoutChanged : undefined}
        {...props}
      >
        {children}
      </Group>
    </ResizableContext.Provider>
  );
};

interface ResizablePanelProps {
  children?: ReactNode;
  className?: string;
  collapsedSize?: number | string;
  collapsible?: boolean;
  defaultSize?: number | string;
  handleRef?: React.Ref<PanelImperativeHandle>;
  id?: string;
  maxSize?: number | string;
  minSize?: number | string;
  onCollapse?: () => void;
  onExpand?: () => void;
  onResize?: (
    panelSize: PanelSize,
    id: string | number | undefined,
    prevPanelSize: PanelSize | undefined
  ) => void;
  style?: React.CSSProperties;
}

const ResizablePanel = ({
  children,
  className,
  collapsedSize,
  collapsible,
  defaultSize,
  handleRef,
  id,
  maxSize,
  minSize,
  onCollapse,
  onExpand,
  onResize,
  style,
}: ResizablePanelProps) => {
  const { slots } = useResizableContext();
  const panelRef = useRef<PanelImperativeHandle | null>(null);
  const wasCollapsedRef = useRef<boolean | undefined>(undefined);
  const mergedRef = useCallback(
    (el: PanelImperativeHandle | null) => {
      panelRef.current = el;
      if (typeof handleRef === 'function') {
        handleRef(el);
      } else if (handleRef) {
        (
          handleRef as React.MutableRefObject<PanelImperativeHandle | null>
        ).current = el;
      }
    },
    [handleRef]
  );

  const hasCollapseCallbacks = collapsible && (onCollapse || onExpand);

  const handleResize = useCallback(
    (
      size: PanelSize,
      panelId: string | number | undefined,
      prevSize: PanelSize | undefined
    ) => {
      if (hasCollapseCallbacks && panelRef.current) {
        const isCollapsed = panelRef.current.isCollapsed();
        if (wasCollapsedRef.current !== undefined) {
          if (isCollapsed && !wasCollapsedRef.current) {
            onCollapse?.();
          } else if (!isCollapsed && wasCollapsedRef.current) {
            onExpand?.();
          }
        }
        wasCollapsedRef.current = isCollapsed;
      }
      onResize?.(size, panelId, prevSize);
    },
    [hasCollapseCallbacks, onCollapse, onExpand, onResize]
  );

  return (
    <Panel
      className={composeSlotClassName(slots?.panel, className)}
      collapsedSize={normalizePanelSize(collapsedSize)}
      collapsible={collapsible}
      data-slot="resizable-panel"
      defaultSize={normalizePanelSize(defaultSize)}
      id={id}
      maxSize={normalizePanelSize(maxSize)}
      minSize={normalizePanelSize(minSize)}
      panelRef={hasCollapseCallbacks ? mergedRef : handleRef}
      style={style}
      onResize={hasCollapseCallbacks ? handleResize : onResize}
    >
      {children}
    </Panel>
  );
};

interface ResizableHandleProps {
  'aria-label'?: string;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  type?: ResizableVariants['type'];
  variant?: ResizableVariants['variant'];
  withIndicator?: boolean;
}

const ResizableHandle = ({
  'aria-label': ariaLabel,
  children,
  className,
  disabled,
  id,
  type = 'line',
  variant = 'primary',
  withIndicator,
}: ResizableHandleProps) => {
  const { orientation } = useResizableContext();
  const slots = useMemo(
    () => resizableVariants({ orientation, type, variant }),
    [orientation, type, variant]
  );
  const showIndicator = children == null && (withIndicator ?? type !== 'line');
  const indicatorType = type === 'drag' ? 'drag' : 'pill';

  return (
    <Separator
      aria-label={ariaLabel ?? 'Resize handle'}
      className={composeSlotClassName(slots?.handle, className)}
      data-slot="resizable-handle"
      data-type={type}
      data-variant={variant}
      disabled={disabled}
      id={id}
    >
      {children}
      {showIndicator ? <ResizableIndicator type={indicatorType} /> : null}
    </Separator>
  );
};

interface ResizableIndicatorProps {
  children?: ReactNode;
  className?: string;
  type?: 'drag' | 'pill';
}

const ResizableIndicator = ({
  children,
  className,
  type = 'pill',
}: ResizableIndicatorProps) => {
  const { orientation, slots } = useResizableContext();

  if (children) {
    return (
      <span
        className={composeSlotClassName(slots?.indicator, className)}
        data-slot="resizable-handle-indicator"
      >
        {children}
      </span>
    );
  }

  if (type === 'drag') {
    const Icon = orientation === 'horizontal' ? Grip : GripHorizontal;
    return (
      <span
        aria-hidden="true"
        className={composeSlotClassName(slots?.indicator, className, {
          type: 'drag',
        })}
        data-slot="resizable-handle-indicator"
      >
        <Icon
          className="resizable__handle-indicator-icon"
          data-slot="resizable-handle-indicator-icon"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={composeSlotClassName(slots?.indicator, className, {
        type: 'pill',
      })}
      data-slot="resizable-handle-indicator"
    />
  );
};

export {
  ResizableContext,
  ResizableHandle,
  ResizableIndicator,
  ResizablePanel,
  ResizableRoot,
  useResizableContext,
};
export type {
  ResizableContextValue,
  ResizableHandleProps,
  ResizableIndicatorProps,
  ResizablePanelProps,
  ResizableRootProps,
};
