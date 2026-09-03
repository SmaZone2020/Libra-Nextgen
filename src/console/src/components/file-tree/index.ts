import type { ComponentProps } from 'react';
import {
  FileTreeChevron,
  FileTreeIcon,
  FileTreeItem,
  FileTreeItemContent,
  FileTreeLabel,
  FileTreeRoot,
} from './file-tree';

export { fileTreeVariants } from './file-tree.styles';

const FileTree = Object.assign(FileTreeRoot, {
  Chevron: FileTreeChevron,
  Icon: FileTreeIcon,
  Item: FileTreeItem,
  ItemContent: FileTreeItemContent,
  Label: FileTreeLabel,
  Root: FileTreeRoot,
});

export {
  FileTree,
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
  FileTreeRootProps as FileTreeProps,
  FileTreeRootProps,
} from './file-tree';
export type { FileTreeVariants } from './file-tree.styles';

export type FileTree = {
  ChevronProps: ComponentProps<typeof FileTreeChevron>;
  IconProps: ComponentProps<typeof FileTreeIcon>;
  ItemContentProps: ComponentProps<typeof FileTreeItemContent>;
  ItemProps: ComponentProps<typeof FileTreeItem>;
  LabelProps: ComponentProps<typeof FileTreeLabel>;
  Props: ComponentProps<typeof FileTreeRoot>;
  RootProps: ComponentProps<typeof FileTreeRoot>;
};
