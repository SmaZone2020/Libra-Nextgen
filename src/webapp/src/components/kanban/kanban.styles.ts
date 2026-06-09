import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const kanbanVariants = tv({
  defaultVariants: {
    size: 'md',
  },
  slots: {
    base: 'kanban',
    card: 'kanban__card',
    cardContent: 'kanban__card-content',
    cardList: 'kanban__card-list',
    column: 'kanban__column',
    columnActions: 'kanban__column-actions',
    columnBody: 'kanban__column-body',
    columnCount: 'kanban__column-count',
    columnHeader: 'kanban__column-header',
    columnIndicator: 'kanban__column-indicator',
    columnTitle: 'kanban__column-title',
    dragHandle: 'kanban__drag-handle',
    dropIndicator: 'kanban__drop-indicator',
    empty: 'kanban__empty',
    scrollShadow: 'kanban__scroll-shadow',
  },
  variants: {
    size: {
      lg: {
        base: 'kanban--lg',
        card: 'kanban__card--lg',
        cardContent: 'kanban__card-content--lg',
        cardList: 'kanban__card-list--lg',
      },
      md: {
        base: 'kanban--md',
        card: 'kanban__card--md',
        cardContent: 'kanban__card-content--md',
        cardList: 'kanban__card-list--md',
      },
      sm: {
        base: 'kanban--sm',
        card: 'kanban__card--sm',
        cardContent: 'kanban__card-content--sm',
        cardList: 'kanban__card-list--sm',
      },
    },
  },
});

export type KanbanVariants = VariantProps<typeof kanbanVariants>;
