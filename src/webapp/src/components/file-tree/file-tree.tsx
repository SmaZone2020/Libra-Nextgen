'use client';

import type { ComponentPropsWithRef, ReactNode, SVGProps } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Button } from 'react-aria-components/Button';
import {
  Tree,
  TreeItem,
  TreeItemContent,
  type TreeItemContentRenderProps,
} from 'react-aria-components/Tree';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { FileTreeVariants } from './file-tree.styles';
import { fileTreeVariants } from './file-tree.styles';

interface FileTreeContextValue {
  slots?: ReturnType<typeof fileTreeVariants>;
  size?: FileTreeVariants['size'];
}

const FileTreeContext = createContext<FileTreeContextValue>({});

/* -------------------------------------------------------------------------------------------------
 * FileTree Root
 * -----------------------------------------------------------------------------------------------*/

interface FileTreeRootProps<T extends object> extends Omit<
  ComponentPropsWithRef<typeof Tree<T>>,
  'children'
> {
  children: ReactNode;
  /** Visual size. @default "md" */
  size?: FileTreeVariants['size'];
}

const FileTreeRoot = <T extends object>({
  children,
  className,
  size = 'md',
  ...props
}: FileTreeRootProps<T>) => {
  const slots = useMemo(() => fileTreeVariants({ size }), [size]);

  return (
    <FileTreeContext.Provider value={{ slots, size }}>
      <Tree
        className={composeTwRenderProps(className, slots?.base())}
        data-slot="file-tree"
        {...props}
      >
        {children}
      </Tree>
    </FileTreeContext.Provider>
  );
};

/* -------------------------------------------------------------------------------------------------
 * FileTree Item
 * -----------------------------------------------------------------------------------------------*/

interface FileTreeItemProps<T extends object> extends Omit<
  ComponentPropsWithRef<typeof TreeItem<T>>,
  'children'
> {
  children: ReactNode;
}

const FileTreeItem = <T extends object>({
  children,
  className,
  ...props
}: FileTreeItemProps<T>) => {
  const { slots } = useContext(FileTreeContext);

  return (
    <TreeItem
      className={composeTwRenderProps(className, slots?.item())}
      data-slot="file-tree-item"
      {...props}
    >
      {children}
    </TreeItem>
  );
};

/* -------------------------------------------------------------------------------------------------
 * FileTree ItemContent
 * -----------------------------------------------------------------------------------------------*/

interface FileTreeItemContentProps {
  children: ReactNode | ((values: TreeItemContentRenderProps) => ReactNode);
  className?: string;
}

const FileTreeItemContent = ({
  children,
  className,
}: FileTreeItemContentProps) => {
  const { slots } = useContext(FileTreeContext);

  return (
    <TreeItemContent>
      {(values) => (
        <div
          className={composeSlotClassName(slots?.itemContent, className)}
          data-slot="file-tree-item-content"
        >
          {typeof children === 'function' ? children(values) : children}
        </div>
      )}
    </TreeItemContent>
  );
};

/* -------------------------------------------------------------------------------------------------
 * FileTree Chevron
 * -----------------------------------------------------------------------------------------------*/

const DEFAULT_CHEVRON_ICON = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    {...props}
  >
    <path
      d="M6 4l4 4-4 4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

interface FileTreeChevronProps extends ComponentPropsWithRef<typeof Button> {
  children?: ReactNode;
}

const FileTreeChevron = ({
  children,
  className,
  ...props
}: FileTreeChevronProps) => {
  const { slots } = useContext(FileTreeContext);

  return (
    <Button
      slot="chevron"
      className={composeTwRenderProps(className, slots?.chevron())}
      data-slot="file-tree-chevron"
      {...props}
    >
      {children ?? (
        <DEFAULT_CHEVRON_ICON className={slots?.indicator()} />
      )}
    </Button>
  );
};

/* -------------------------------------------------------------------------------------------------
 * FileTree Icon
 * -----------------------------------------------------------------------------------------------*/

interface FileTreeIconProps extends ComponentPropsWithRef<'span'> {
  children?: ReactNode;
}

const FileTreeIcon = ({ children, className, ...props }: FileTreeIconProps) => {
  const { slots } = useContext(FileTreeContext);

  return (
    <span
      className={composeSlotClassName(slots?.icon, className)}
      data-slot="file-tree-icon"
      {...props}
    >
      {children}
    </span>
  );
};

/* -------------------------------------------------------------------------------------------------
 * FileTree Label
 * -----------------------------------------------------------------------------------------------*/

interface FileTreeLabelProps extends ComponentPropsWithRef<'span'> {
  children?: ReactNode;
}

const FileTreeLabel = ({
  children,
  className,
  ...props
}: FileTreeLabelProps) => {
  const { slots } = useContext(FileTreeContext);

  return (
    <span
      className={composeSlotClassName(slots?.label, className)}
      data-slot="file-tree-label"
      {...props}
    >
      {children}
    </span>
  );
};

export {
  FileTreeChevron,
  FileTreeIcon,
  FileTreeItem,
  FileTreeItemContent,
  FileTreeLabel,
  FileTreeRoot,
};

export type {
  FileTreeChevronProps,
  FileTreeIconProps,
  FileTreeItemContentProps,
  FileTreeItemProps,
  FileTreeLabelProps,
  FileTreeRootProps,
};
