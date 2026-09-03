import type { ReactNode } from 'react';
import React from 'react';
import { Button as RACButton } from 'react-aria-components/Button';
import { Button, Checkbox, Table } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import { ChevronRight, Grip } from './data-grid.icons';
import type { DataGridColumn, PinnedInfo } from './data-grid.types';
import type { DataGridSlots } from './data-grid.types';

interface DataGridRowProps<T extends object> {
  item: T;
  columns: DataGridColumn<T>[];
  slots: DataGridSlots;
  pinnedInfo: PinnedInfo | null;
  getRowId: (item: T) => string | number;
  showSelectionCheckboxes: boolean;
  selectionMode: string;
  hasDnd: boolean;
  isTreeTable: boolean;
  treeColumnId?: string;
  treeIndent: number;
  getChildren?: (item: T) => T[] | undefined;
}

export function DataGridRow<T extends object>({
  item,
  columns,
  slots,
  pinnedInfo,
  getRowId,
  showSelectionCheckboxes,
  selectionMode,
  hasDnd,
  isTreeTable,
  treeColumnId,
  treeIndent,
  getChildren,
}: DataGridRowProps<T>) {
  const rowId = getRowId(item);
  const children = isTreeTable ? (getChildren?.(item) ?? []) : [];
  const hasChildItems = isTreeTable && children.length > 0;

  const renderCell = (col: DataGridColumn<T>): ReactNode => {
    let cellContent: ReactNode;
    if (col.cell) {
      cellContent = col.cell(item, col);
    } else if (col.accessorKey) {
      const val = item[col.accessorKey];
      cellContent = val == null ? '' : String(val);
    } else {
      cellContent = null;
    }

    const isPinned = !!col.pinned && !!pinnedInfo;
    const offset = pinnedInfo?.offsets.get(col.id);
    const isEdge =
      col.id === pinnedInfo?.startEdgeId ||
      col.id === pinnedInfo?.endEdgeId;

    const treeCell =
      isTreeTable && col.id === treeColumnId
        ? ({
            hasChildItems: childHas,
            isDisabled,
            isExpanded,
            level,
          }: {
            hasChildItems: boolean;
            isDisabled: boolean;
            isExpanded: boolean;
            level: number;
          }) => (
            <span
              className={composeSlotClassName(slots?.treeCell, undefined)}
              data-slot="data-grid-tree-cell"
              style={
                treeIndent && level > 1
                  ? { paddingInlineStart: (level - 1) * treeIndent }
                  : undefined
              }
            >
              {childHas ? (
                <Button
                  isIconOnly
                  aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                  className={composeSlotClassName(
                    slots?.treeToggle,
                    undefined
                  )}
                  isDisabled={isDisabled}
                  size="sm"
                  slot="chevron"
                  variant="ghost"
                >
                  <ChevronRight
                    aria-hidden
                    className={composeSlotClassName(
                      slots?.treeToggleIcon,
                      undefined
                    )}
                    data-expanded={isExpanded || undefined}
                  />
                </Button>
              ) : (
                <span
                  aria-hidden
                  className={composeSlotClassName(
                    slots?.treeToggleSpacer,
                    undefined
                  )}
                  data-slot="data-grid-tree-toggle-spacer"
                />
              )}
              <span>{cellContent}</span>
            </span>
          )
        : undefined;

    return (
      <Table.Cell
        className={col.cellClassName}
        data-align={col.align}
        data-pinned={col.pinned ?? undefined}
        data-pinned-edge={isEdge || undefined}
        key={col.id}
        style={
          isPinned
            ? col.pinned === 'start'
              ? { insetInlineStart: offset }
              : { insetInlineEnd: offset }
            : undefined
        }
      >
        {treeCell ?? cellContent}
      </Table.Cell>
    );
  };

  return (
    <Table.Row
      hasChildItems={hasChildItems || undefined}
      id={rowId}
      key={rowId}
    >
      {showSelectionCheckboxes && selectionMode !== 'none' && (
        <Table.Cell
          className={composeSlotClassName(slots?.selectionCell, undefined)}
          data-pinned={pinnedInfo?.hasStartPinned ? 'start' : undefined}
          style={
            pinnedInfo?.hasStartPinned ? { insetInlineStart: 0 } : undefined
          }
        >
          <Checkbox
            aria-label="Select row"
            slot="selection"
            variant="secondary"
          >
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox>
        </Table.Cell>
      )}
      {hasDnd && (
        <Table.Cell
          className={composeSlotClassName(slots?.dragHandleCell, undefined)}
          data-pinned={pinnedInfo?.hasStartPinned ? 'start' : undefined}
          style={
            pinnedInfo?.hasStartPinned
              ? {
                  insetInlineStart:
                    showSelectionCheckboxes && selectionMode !== 'none'
                      ? 40
                      : 0,
                }
              : undefined
          }
        >
          <RACButton
            className={composeSlotClassName(slots?.dragHandle, undefined)}
            slot="drag"
          >
            <Grip />
          </RACButton>
        </Table.Cell>
      )}
      {columns.map((col) => renderCell(col))}
      {hasChildItems ? (
        <Table.Collection items={children}>
          {(child) => (
            <DataGridRow
              columns={columns}
              getChildren={getChildren}
              getRowId={getRowId}
              hasDnd={hasDnd}
              isTreeTable={isTreeTable}
              item={child as T}
              pinnedInfo={pinnedInfo}
              selectionMode={selectionMode}
              showSelectionCheckboxes={showSelectionCheckboxes}
              slots={slots}
              treeColumnId={treeColumnId}
              treeIndent={treeIndent}
            />
          )}
        </Table.Collection>
      ) : null}
    </Table.Row>
  );
}
