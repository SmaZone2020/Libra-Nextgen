import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const dataGridVariants = tv({
  slots: {
    base: 'data-grid',
    dragHandle: 'data-grid__drag-handle',
    dragHandleCell: 'data-grid__drag-handle-cell',
    dragHandleColumn: 'data-grid__drag-handle-column',
    emptyState: 'data-grid__empty-state',
    selectionCell: 'data-grid__selection-cell',
    selectionColumn: 'data-grid__selection-column',
    sortIcon: 'data-grid__sort-icon',
    treeCell: 'data-grid__tree-cell',
    treeToggle: 'data-grid__tree-toggle',
    treeToggleIcon: 'data-grid__tree-toggle-icon',
    treeToggleSpacer: 'data-grid__tree-toggle-spacer',
  },
});

export type DataGridVariants = VariantProps<typeof dataGridVariants>;
