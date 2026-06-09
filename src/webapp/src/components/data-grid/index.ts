import type { ComponentProps } from 'react';
import { DataGrid } from './data-grid';

export type DataGrid = {
  Props: ComponentProps<typeof DataGrid>;
};

export { DataGrid };
export type {
  DataGridColumn,
  ColumnSize as DataGridColumnSize,
  DataGridProps,
  DataGridReorderEvent,
  Selection as DataGridSelection,
  SortDescriptor as DataGridSortDescriptor,
  SortDirection as DataGridSortDirection,
} from './data-grid';
export type { DataGridVariants } from './data-grid.styles';
export { dataGridVariants } from './data-grid.styles';
