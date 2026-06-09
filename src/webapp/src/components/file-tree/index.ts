import {
  FileTreeHeader,
  FileTreeIndicator,
  FileTreeItem,
  FileTreeRoot,
  FileTreeSection,
} from './file-tree';

export { fileTreeVariants } from './file-tree.styles';
export { useFileTree } from './use-file-tree';
export { useFileTreeDrag } from './use-file-tree-drag';

export const FileTree = Object.assign(FileTreeRoot, {
  Header: FileTreeHeader,
  Indicator: FileTreeIndicator,
  Item: FileTreeItem,
  Root: FileTreeRoot,
  Section: FileTreeSection,
});

export {
  FileTreeHeader,
  FileTreeIndicator,
  FileTreeItem,
  FileTreeRoot,
  FileTreeSection,
};

export type {
  FileTreeHeaderProps,
  FileTreeIndicatorProps,
  FileTreeItemProps,
  FileTreeItemRenderProps,
  FileTreeRootProps as FileTreeProps,
  FileTreeRootProps,
  FileTreeSectionProps,
} from './file-tree';
export type { FileTreeVariants } from './file-tree.styles';
export { fileTreeVariants as default } from './file-tree.styles';
export type {
  TreeNode,
  UseFileTreeOptions,
  UseFileTreeReturn,
} from './use-file-tree';
export type {
  TreeDataManager,
  UseFileTreeDragOptions,
} from './use-file-tree-drag';
