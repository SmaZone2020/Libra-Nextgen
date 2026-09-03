import type { ReactNode } from 'react';
import React, { useContext } from 'react';
import { Table } from '@heroui/react';
import type { SortDirection } from 'react-aria-components/Table';
import { composeSlotClassName } from '../../utils/compose';
import { ChevronUp } from './data-grid.icons';
import type { DataGridColumn, DataGridSlots, PinnedInfo } from './data-grid.types';

// ── Context ──────────────────────────────────────────────────────────────────

export interface DataGridContextValue {
  slots?: DataGridSlots;
}

export const DataGridContext = React.createContext<DataGridContextValue>({});

// ── SortHeader ────────────────────────────────────────────────────────────────

interface SortHeaderProps {
  children: ReactNode;
  sortDirection?: SortDirection;
}

export function SortHeader({ children, sortDirection }: SortHeaderProps) {
  const { slots } = useContext(DataGridContext);

  return (
    <span data-slot="data-grid-sort-header">
      {children}
      {!!sortDirection && (
        <ChevronUp
          className={composeSlotClassName(slots?.sortIcon, undefined)}
          data-direction={sortDirection}
          data-slot="data-grid-sort-icon"
        />
      )}
    </span>
  );
}

// ── Header column ─────────────────────────────────────────────────────────────

interface DataGridHeaderColumnProps<T extends object> {
  col: DataGridColumn<T>;
  slots: DataGridSlots;
  pinnedInfo: PinnedInfo | null;
  allowsColumnResize: boolean;
}

export function DataGridHeaderColumn<T extends object>({
  col,
  slots,
  pinnedInfo,
  allowsColumnResize,
}: DataGridHeaderColumnProps<T>) {
  const staticHeader =
    typeof col.header === 'function' ? null : col.header;
  const renderHeader =
    typeof col.header === 'function' ? col.header : null;
  const resizer =
    allowsColumnResize && col.allowsResizing !== false ? (
      <Table.ColumnResizer />
    ) : null;
  const hasDynamicHeader = col.allowsSorting || renderHeader;
  const isPinned = !!col.pinned && !!pinnedInfo;
  const offset = pinnedInfo?.offsets.get(col.id);
  const isEdge =
    col.id === pinnedInfo?.startEdgeId ||
    col.id === pinnedInfo?.endEdgeId;

  return (
    <Table.Column
      allowsSorting={col.allowsSorting}
      className={col.headerClassName}
      data-align={col.align}
      data-pinned={col.pinned ?? undefined}
      data-pinned-edge={isEdge || undefined}
      id={col.id}
      isRowHeader={col.isRowHeader}
      key={col.id}
      maxWidth={col.maxWidth}
      minWidth={col.minWidth}
      style={
        isPinned
          ? col.pinned === 'start'
            ? { insetInlineStart: offset }
            : { insetInlineEnd: offset }
          : undefined
      }
      width={col.width}
    >
      {hasDynamicHeader ? (
        ({ sortDirection }: { sortDirection?: SortDirection }) => {
          const content = renderHeader
            ? renderHeader({ sortDirection })
            : staticHeader;
          return (
            <>
              {col.allowsSorting ? (
                <SortHeader sortDirection={sortDirection}>
                  {content}
                </SortHeader>
              ) : (
                content
              )}
              {resizer}
            </>
          );
        }
      ) : (
        <>
          {staticHeader}
          {resizer}
        </>
      )}
    </Table.Column>
  );
}
