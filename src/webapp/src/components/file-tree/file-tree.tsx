'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import React, { createContext, useContext, useMemo } from 'react';
import { Button as ButtonPrimitive } from 'react-aria-components/Button';
import {
  Tree as TreePrimitive,
  TreeHeader as TreeHeaderPrimitive,
  TreeItem as TreeItemPrimitive,
  TreeItemContent,
  TreeSection as TreeSectionPrimitive,
} from 'react-aria-components/Tree';
import { Checkbox } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { TreeMotionProvider } from '../../utils/tree-motion';
import { ChevronRight } from '../icons';
import type { FileTreeVariants } from './file-tree.styles';
import { fileTreeVariants } from './file-tree.styles';

// ---- Context ----

type FileTreeContextValue = {
  slots?: ReturnType<typeof fileTreeVariants>;
};

const FileTreeContext = createContext<FileTreeContextValue>({});

// ---- Grip icon ----

function GripDotsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="9" cy="5" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="19" r="1" />
    </svg>
  );
}

// ---- Guide-line level map ----

const GUIDE_LINE_MAP: Record<string, 'always' | 'hover' | 'none'> = {
  false: 'none',
  hover: 'hover',
  true: 'always',
};

// ---- Types ----

export interface FileTreeRootProps<
  T extends object,
> extends ComponentPropsWithRef<typeof TreePrimitive<T>> {
  /** Whether to show indent guide lines. `true` = always, `false` = never, `"hover"` = on tree hover only. @default true */
  showGuideLines?: boolean | 'hover';
  /** Whether to disable expand/collapse animations. Also respects the user's reduced-motion preference. @default false */
  reduceMotion?: boolean;
  /** Size variant. @default "md" */
  size?: FileTreeVariants['size'];
}

export interface FileTreeIndicatorProps extends ComponentPropsWithRef<
  typeof ChevronRight
> {
  className?: string;
}

export interface FileTreeItemRenderProps {
  isExpanded: boolean;
  hasChildItems: boolean;
  allowsDragging: boolean;
}

export interface FileTreeItemProps extends Partial<
  ComponentPropsWithRef<typeof TreeItemPrimitive>
> {
  /** Icon rendered before the label. Accepts a ReactNode or a function receiving `{ isExpanded, hasChildItems, allowsDragging }`. */
  icon?: ReactNode | ((props: FileTreeItemRenderProps) => ReactNode);
  /** Drag handle icon shown when dragging is allowed. Pass `false` to hide, or a ReactNode to replace the default grip icon. @default <GripVertical /> */
  dragIcon?: ReactNode | false;
  /** Label content rendered as the item text. */
  title: ReactNode;
}

export interface FileTreeSectionProps extends ComponentPropsWithRef<
  typeof TreeSectionPrimitive
> {}

export interface FileTreeHeaderProps extends ComponentPropsWithRef<
  typeof TreeHeaderPrimitive
> {}

// ---- Components ----

export const FileTreeRoot = <T extends object>({
  children,
  className,
  reduceMotion = false,
  showGuideLines = true,
  size,
  ...props
}: FileTreeRootProps<T>) => {
  const guideLinesKey = GUIDE_LINE_MAP[String(showGuideLines)];
  const slots = useMemo(
    () => fileTreeVariants({ guideLines: guideLinesKey, size }),
    [guideLinesKey, size]
  );

  return (
    <FileTreeContext.Provider value={{ slots }}>
      <TreeMotionProvider reduceMotion={reduceMotion}>
        <TreePrimitive
          className={composeTwRenderProps(className, slots?.base())}
          data-slot="file-tree"
          {...props}
        >
          {children}
        </TreePrimitive>
      </TreeMotionProvider>
    </FileTreeContext.Provider>
  );
};

export const FileTreeIndicator = ({
  children,
  className,
  ...props
}: FileTreeIndicatorProps) => {
  const { slots } = useContext(FileTreeContext);
  if (children && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<Record<string, unknown>>,
      {
        ...props,
        className: composeSlotClassName(slots?.indicator, className),
        'data-slot': 'file-tree-indicator',
      }
    );
  }
  return (
    <ChevronRight
      className={composeSlotClassName(slots?.indicator, className)}
      data-slot="file-tree-indicator"
      {...props}
    />
  );
};

export const FileTreeItem = ({
  children,
  className,
  dragIcon,
  icon,
  render: renderProp,
  title,
  ...props
}: FileTreeItemProps) => {
  const { slots } = useContext(FileTreeContext);
  const textValue = typeof title === 'string' ? title : (props.textValue ?? '');

  let customIndicator: React.ReactNode = null;
  const otherChildren: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === FileTreeIndicator) {
      customIndicator = child;
    } else {
      otherChildren.push(child);
    }
  });

  return (
    <TreeItemPrimitive
      className={composeTwRenderProps(className, slots?.item())}
      data-slot="file-tree-item"
      render={renderProp}
      textValue={textValue}
      {...props}
    >
      <TreeItemContent>
        {({
          allowsDragging,
          hasChildItems,
          isExpanded,
          level,
          selectionBehavior,
          selectionMode,
        }) => {
          const resolvedIcon =
            typeof icon === 'function'
              ? icon({
                  allowsDragging: !!allowsDragging,
                  hasChildItems,
                  isExpanded,
                })
              : icon;
          const showCheckbox =
            selectionBehavior === 'toggle' && selectionMode !== 'none';

          return (
            <div
              className={slots?.itemContent()}
              data-slot="file-tree-item-content"
            >
              {Array.from({ length: level - 1 }, (_, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className={slots?.guideLine()}
                  data-slot="file-tree-guide-line"
                  style={{
                    left: `calc(var(--file-tree-item-px) + ${i} * var(--file-tree-indent) + var(--file-tree-indent) / 2)`,
                  }}
                />
              ))}
              {!!allowsDragging && dragIcon !== false && (
                <ButtonPrimitive
                  className={slots?.dragHandle()}
                  data-slot="file-tree-drag-handle"
                  slot="drag"
                >
                  {dragIcon ?? <GripDotsIcon />}
                </ButtonPrimitive>
              )}
              {showCheckbox && (
                <span
                  className={slots?.checkbox()}
                  data-slot="file-tree-checkbox"
                >
                  <Checkbox aria-label="Select" slot="selection">
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                  </Checkbox>
                </span>
              )}
              <ButtonPrimitive className={slots?.chevron()} slot="chevron">
                {customIndicator ?? <FileTreeIndicator />}
              </ButtonPrimitive>
              {hasChildItems || resolvedIcon ? (
                <span className={slots?.icon()} data-slot="file-tree-icon">
                  {resolvedIcon}
                </span>
              ) : null}
              <span className={slots?.label()} data-slot="file-tree-label">
                {title}
              </span>
            </div>
          );
        }}
      </TreeItemContent>
      {otherChildren}
    </TreeItemPrimitive>
  );
};

export const FileTreeSection = ({
  children,
  className,
  ...props
}: FileTreeSectionProps) => {
  const { slots } = useContext(FileTreeContext);
  return (
    <TreeSectionPrimitive
      className={composeSlotClassName(slots?.section, className)}
      data-slot="file-tree-section"
      {...props}
    >
      {children}
    </TreeSectionPrimitive>
  );
};

export const FileTreeHeader = ({
  children,
  className,
  ...props
}: FileTreeHeaderProps) => {
  const { slots } = useContext(FileTreeContext);
  return (
    <TreeHeaderPrimitive
      className={composeSlotClassName(slots?.sectionHeader, className)}
      data-slot="file-tree-section-header"
      {...props}
    >
      {children}
    </TreeHeaderPrimitive>
  );
};
