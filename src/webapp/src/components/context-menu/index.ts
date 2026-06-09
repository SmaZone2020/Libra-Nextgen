import type { ComponentProps } from 'react';
import {
  ContextMenuItem,
  ContextMenuItemIndicator,
  ContextMenuMenu,
  ContextMenuPopover,
  ContextMenuRoot,
  ContextMenuSection,
  ContextMenuSeparator,
  ContextMenuSubmenuIndicator,
  ContextMenuSubmenuTrigger,
  ContextMenuTrigger,
} from './context-menu';

export const ContextMenu = Object.assign(ContextMenuRoot, {
  Item: ContextMenuItem,
  ItemIndicator: ContextMenuItemIndicator,
  Menu: ContextMenuMenu,
  Popover: ContextMenuPopover,
  Root: ContextMenuRoot,
  Section: ContextMenuSection,
  Separator: ContextMenuSeparator,
  SubmenuIndicator: ContextMenuSubmenuIndicator,
  SubmenuTrigger: ContextMenuSubmenuTrigger,
  Trigger: ContextMenuTrigger,
});

export type ContextMenu<T extends object = object> = {
  ItemIndicatorProps: ComponentProps<typeof ContextMenuItemIndicator>;
  ItemProps: ComponentProps<typeof ContextMenuItem>;
  MenuProps: ComponentProps<typeof ContextMenuMenu<T>>;
  PopoverProps: ComponentProps<typeof ContextMenuPopover>;
  Props: ComponentProps<typeof ContextMenuRoot>;
  RootProps: ComponentProps<typeof ContextMenuRoot>;
  SectionProps: ComponentProps<typeof ContextMenuSection>;
  SeparatorProps: ComponentProps<typeof ContextMenuSeparator>;
  SubmenuIndicatorProps: ComponentProps<typeof ContextMenuSubmenuIndicator>;
  SubmenuTriggerProps: ComponentProps<typeof ContextMenuSubmenuTrigger>;
  TriggerProps: ComponentProps<typeof ContextMenuTrigger>;
};

export {
  ContextMenuItem,
  ContextMenuItemIndicator,
  ContextMenuMenu,
  ContextMenuPopover,
  ContextMenuRoot,
  ContextMenuSection,
  ContextMenuSeparator,
  ContextMenuSubmenuIndicator,
  ContextMenuSubmenuTrigger,
  ContextMenuTrigger,
};
export type {
  ContextMenuItemIndicatorProps,
  ContextMenuItemProps,
  ContextMenuMenuProps,
  ContextMenuPopoverProps,
  ContextMenuRootProps as ContextMenuProps,
  ContextMenuRootProps,
  ContextMenuSectionProps,
  ContextMenuSeparatorProps,
  ContextMenuSubmenuIndicatorProps,
  ContextMenuSubmenuTriggerProps,
  ContextMenuTriggerProps,
} from './context-menu';
export type { ContextMenuVariants } from './context-menu.styles';
export { contextMenuVariants } from './context-menu.styles';
