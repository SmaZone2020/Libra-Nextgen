import type { ComponentProps } from 'react';
import {
  KanbanCard,
  KanbanCardList,
  KanbanColumn,
  KanbanColumnActions,
  KanbanColumnBody,
  KanbanColumnCount,
  KanbanColumnHeader,
  KanbanColumnIndicator,
  KanbanColumnTitle,
  KanbanDragHandle,
  KanbanDropIndicator,
  KanbanRoot,
  KanbanScrollShadow,
} from './kanban';

export { kanbanVariants } from './kanban.styles';
export {
  useKanban,
  useKanbanCardPlaceholder,
  useKanbanColumn,
} from './use-kanban';

const Kanban = Object.assign(KanbanRoot, {
  Card: KanbanCard,
  CardList: KanbanCardList,
  Column: KanbanColumn,
  ColumnActions: KanbanColumnActions,
  ColumnBody: KanbanColumnBody,
  ColumnCount: KanbanColumnCount,
  ColumnHeader: KanbanColumnHeader,
  ColumnIndicator: KanbanColumnIndicator,
  ColumnTitle: KanbanColumnTitle,
  DragHandle: KanbanDragHandle,
  DropIndicator: KanbanDropIndicator,
  Root: KanbanRoot,
  ScrollShadow: KanbanScrollShadow,
});

export {
  Kanban,
  KanbanCard,
  KanbanCardList,
  KanbanColumn,
  KanbanColumnActions,
  KanbanColumnBody,
  KanbanColumnCount,
  KanbanColumnHeader,
  KanbanColumnIndicator,
  KanbanColumnTitle,
  KanbanDragHandle,
  KanbanDropIndicator,
  KanbanRoot,
  KanbanScrollShadow,
};

export type {
  KanbanCardListProps,
  KanbanCardProps,
  KanbanColumnActionsProps,
  KanbanColumnBodyProps,
  KanbanColumnCountProps,
  KanbanColumnHeaderProps,
  KanbanColumnIndicatorProps,
  KanbanColumnProps,
  KanbanColumnTitleProps,
  KanbanDragHandleProps,
  KanbanDropIndicatorProps,
  KanbanRootProps as KanbanProps,
  KanbanRootProps,
  KanbanScrollShadowProps,
} from './kanban';
export type { KanbanVariants } from './kanban.styles';
export type {
  UseKanbanCardPlaceholderOptions,
  UseKanbanCardPlaceholderReturn,
  UseKanbanColumnOptions,
  UseKanbanColumnReturn,
  UseKanbanOptions,
  UseKanbanReturn,
} from './use-kanban';

export type Kanban<T extends object = object> = {
  Props: ComponentProps<typeof KanbanRoot>;
  RootProps: ComponentProps<typeof KanbanRoot>;
  ColumnProps: ComponentProps<typeof KanbanColumn>;
  ColumnActionsProps: ComponentProps<typeof KanbanColumnActions>;
  ColumnBodyProps: ComponentProps<typeof KanbanColumnBody>;
  ColumnHeaderProps: ComponentProps<typeof KanbanColumnHeader>;
  ColumnIndicatorProps: ComponentProps<typeof KanbanColumnIndicator>;
  ColumnTitleProps: ComponentProps<typeof KanbanColumnTitle>;
  ColumnCountProps: ComponentProps<typeof KanbanColumnCount>;
  CardListProps: ComponentProps<typeof KanbanCardList<T>>;
  CardProps: ComponentProps<typeof KanbanCard<T>>;
  DropIndicatorProps: ComponentProps<typeof KanbanDropIndicator>;
  DragHandleProps: ComponentProps<typeof KanbanDragHandle>;
  ScrollShadowProps: ComponentProps<typeof KanbanScrollShadow>;
};
