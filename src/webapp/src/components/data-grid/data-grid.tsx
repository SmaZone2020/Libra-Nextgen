'use client';

import type { ReactNode } from 'react';
import React from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button as RACButton } from 'react-aria-components/Button';
import type {
  Selection,
  SortDescriptor,
  SortDirection,
} from 'react-aria-components/Table';
import type { DragAndDropHooks } from 'react-aria-components/useDragAndDrop';
import { useDragAndDrop } from 'react-aria-components/useDragAndDrop';
import { TableLayout, Virtualizer } from 'react-aria-components/Virtualizer';
import { Button, Checkbox, Table } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import { ChevronRight, ChevronUp, Grip } from '../icons';
import { dataGridVariants } from './data-grid.styles';

// ── Types ────────────────────────────────────────────────────────────────────

export type ColumnSize = number | `${number}` | `${number}%` | `${number}fr`;

export interface DataGridColumn<T> {
  /** Unique column identifier, used as the sort key and for RAC column id. */
  id: string;
  /** Column header content — string or render function receiving sort info. */
  header: ReactNode | ((info: { sortDirection?: SortDirection }) => ReactNode);
  /** Key on `T` to read the cell value from. Used for default rendering and sorting. */
  accessorKey?: keyof T & string;
  /** Custom cell renderer. Receives the row item and column definition. */
  cell?: (item: T, column: DataGridColumn<T>) => ReactNode;
  /** Mark this column as the row header (for accessibility). */
  isRowHeader?: boolean;
  /** Allow this column to be sorted. */
  allowsSorting?: boolean;
  /** Custom sort comparator. Falls back to locale-aware string comparison. */
  sortFn?: (a: T, b: T) => number;
  /** Allow this column to be resized. Only effective when `allowsColumnResize` is true. */
  allowsResizing?: boolean;
  /** Initial/controlled column width (px, %, or fr). */
  width?: ColumnSize;
  /** Minimum column width when resizing. */
  minWidth?: number;
  /** Maximum column width when resizing. */
  maxWidth?: number;
  /** Cell text alignment. @default "start" */
  align?: 'start' | 'center' | 'end';
  /** Additional className appended to every <th> for this column. */
  headerClassName?: string;
  /** Additional className appended to every <td> for this column. */
  cellClassName?: string;
  /**
   * Pin this column so it stays visible during horizontal scroll.
   * Uses logical directions: `"start"` pins to the inline-start edge
   * (left in LTR, right in RTL), `"end"` pins to the inline-end edge.
   * Pinned columns must have a numeric `width` or `minWidth`.
   */
  pinned?: 'start' | 'end';
}

export interface DataGridReorderEvent<T> {
  /** The keys that were moved. */
  keys: Set<string | number>;
  /** The target row key and drop position. */
  target: {
    key: string | number;
    dropPosition: 'before' | 'after';
  };
  /** Convenience: the full reordered data array after applying the move. */
  reorderedData: T[];
}

export interface DataGridProps<T extends object> {
  /** Row data array. */
  data: T[];
  /** Column definitions. */
  columns: DataGridColumn<T>[];
  /** Extracts a unique key from each row item. */
  getRowId: (item: T) => string | number;
  /** Visual variant passed to the underlying Table. @default "primary" */
  variant?: 'primary' | 'secondary';
  /** Accessible label for the table. */
  'aria-label': string;
  /** Additional className for the root wrapper. */
  className?: string;
  /** Additional className for the inner `<table>` element. */
  contentClassName?: string;
  /** Additional className for the scroll container. */
  scrollContainerClassName?: string;
  /** Vertical alignment of cell content within each row. @default "middle" */
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** Row selection mode. @default "none" */
  selectionMode?: 'none' | 'single' | 'multiple';
  /** Controlled selected row keys. */
  selectedKeys?: Selection;
  /** Default selected row keys (uncontrolled). */
  defaultSelectedKeys?: Selection;
  /** Callback when selection changes. */
  onSelectionChange?: (keys: Selection) => void;
  /** Selection interaction model. @default "toggle" */
  selectionBehavior?: 'toggle' | 'replace';
  /** Auto-prepend a checkbox column for selection. @default false */
  showSelectionCheckboxes?: boolean;
  /** Controlled sort descriptor. When provided, sorting is controlled externally. */
  sortDescriptor?: SortDescriptor;
  /** Default sort descriptor (uncontrolled). */
  defaultSortDescriptor?: SortDescriptor;
  /** Callback when sort changes. Fires in both controlled and uncontrolled modes. */
  onSortChange?: (descriptor: SortDescriptor) => void;
  /** Enable column resizing on columns that opt in. @default false */
  allowsColumnResize?: boolean;
  /** Callback during column resize. */
  onColumnResize?: (widths: Map<string | number, ColumnSize>) => void;
  /** Callback when resize ends. */
  onColumnResizeEnd?: (widths: Map<string | number, ColumnSize>) => void;
  /** Convenience callback for row reorder. */
  onReorder?: (event: DataGridReorderEvent<T>) => void;
  /** Advanced: RAC drag-and-drop hooks for custom DnD scenarios. */
  dragAndDropHooks?: DragAndDropHooks;
  /** Callback when a row is actioned (e.g. double-click or Enter). */
  onRowAction?: (key: string | number) => void;
  /** Render function for the empty state when `data` is empty. */
  renderEmptyState?: () => ReactNode;
  /** Callback when the load-more sentinel scrolls into view. */
  onLoadMore?: () => void;
  /** Whether more data is currently being fetched. */
  isLoadingMore?: boolean;
  /** Content to show inside the load-more sentinel row (e.g. a Spinner). */
  loadMoreContent?: ReactNode;
  /** Keys of rows that should be disabled. */
  disabledKeys?: Iterable<string | number>;
  /** Enable row virtualization for large datasets. @default false */
  virtualized?: boolean;
  /** Fixed row height in pixels. Required when `virtualized` is true. @default 42 */
  rowHeight?: number;
  /** Header row height in pixels. Required when `virtualized` is true. @default 36 */
  headingHeight?: number;
  /** Returns the child rows for a given item. Providing this enables expandable (tree) rows. */
  getChildren?: (item: T) => T[] | undefined;
  /** Column id that displays the hierarchy chevron. */
  treeColumn?: string;
  /** Controlled set of expanded row keys. */
  expandedKeys?: Selection;
  /** Default expanded row keys (uncontrolled). */
  defaultExpandedKeys?: Selection;
  /** Callback fired when the expanded rows change. */
  onExpandedChange?: (keys: Selection) => void;
  /**
   * Pixels of inline-start padding added per nested level on the tree column cell.
   * @default 20
   */
  treeIndent?: number;
}

// ── Context ──────────────────────────────────────────────────────────────────

interface DataGridContextValue {
  slots?: ReturnType<typeof dataGridVariants>;
}

const DataGridContext = createContext<DataGridContextValue>({});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface PinnedInfo {
  endEdgeId: string | null;
  hasEndPinned: boolean;
  hasStartPinned: boolean;
  offsets: Map<string, number>;
  startEdgeId: string | null;
}

function computePinned<T>(
  columns: DataGridColumn<T>[],
  showSelectionCheckboxes: boolean,
  selectionMode: string,
  hasDnd: boolean
): PinnedInfo | null {
  const hasStart = columns.some((c) => c.pinned === 'start');
  const hasEnd = columns.some((c) => c.pinned === 'end');
  if (!hasStart && !hasEnd) return null;

  const offsets = new Map<string, number>();
  let startEdgeId: string | null = null;
  let endEdgeId: string | null = null;
  let startOffset = 0;

  if (hasStart && showSelectionCheckboxes && selectionMode !== 'none')
    startOffset += 40;
  if (hasStart && hasDnd) startOffset += 32;

  for (const col of columns) {
    if (col.pinned === 'start') {
      offsets.set(col.id, startOffset);
      startEdgeId = col.id;
      startOffset +=
        typeof col.width === 'number' ? col.width : (col.minWidth ?? 0);
    }
  }

  let endOffset = 0;
  for (let i = columns.length - 1; i >= 0; i--) {
    const col = columns[i];
    if (col?.pinned === 'end') {
      offsets.set(col.id, endOffset);
      endEdgeId = col.id;
      endOffset +=
        typeof col.width === 'number' ? col.width : (col.minWidth ?? 0);
    }
  }

  return {
    endEdgeId,
    hasEndPinned: hasEnd,
    hasStartPinned: hasStart,
    offsets,
    startEdgeId,
  };
}

function reorderItems<T>(
  data: T[],
  draggedKeys: Set<string | number>,
  targetKey: string | number,
  dropPosition: 'before' | 'after',
  getId: (item: T) => string | number
): T[] {
  const dragged: T[] = [];
  const rest: T[] = [];
  for (const item of data) {
    if (draggedKeys.has(getId(item))) dragged.push(item);
    else rest.push(item);
  }
  const idx = rest.findIndex((item) => getId(item) === targetKey);
  rest.splice(dropPosition === 'before' ? idx : idx + 1, 0, ...dragged);
  return rest;
}

function buildDndHooks<T>(
  data: T[],
  getId: (item: T) => string | number,
  onReorder: ((event: DataGridReorderEvent<T>) => void) | undefined,
  dragAndDropHooks: DragAndDropHooks | undefined
): DragAndDropHooks | undefined {
  const { dragAndDropHooks: hooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    onReorder(event) {
      if (!onReorder) return;
      const dropPosition = event.target.dropPosition;
      if (dropPosition !== 'before' && dropPosition !== 'after') return;
      const keys = new Set(event.keys) as Set<string | number>;
      const reorderedData = reorderItems(
        data,
        keys,
        event.target.key as string | number,
        dropPosition,
        getId
      );
      onReorder({
        keys,
        reorderedData,
        target: { dropPosition, key: event.target.key as string | number },
      });
    },
  });
  return dragAndDropHooks ?? (onReorder ? hooks : undefined);
}

// ── SortHeader ────────────────────────────────────────────────────────────────

interface SortHeaderProps {
  children: ReactNode;
  sortDirection?: SortDirection;
}

function SortHeader({ children, sortDirection }: SortHeaderProps) {
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

// ── DataGrid ──────────────────────────────────────────────────────────────────

export const DataGrid = function DataGrid<T extends object>(
  props: DataGridProps<T>
) {
  const {
    allowsColumnResize = false,
    'aria-label': ariaLabel,
    className,
    columns,
    contentClassName,
    data,
    defaultExpandedKeys,
    defaultSelectedKeys,
    defaultSortDescriptor,
    disabledKeys,
    dragAndDropHooks: dragAndDropHooksProp,
    expandedKeys,
    getChildren,
    getRowId,
    headingHeight = 36,
    isLoadingMore = false,
    loadMoreContent,
    onColumnResize,
    onColumnResizeEnd,
    onExpandedChange,
    onLoadMore,
    onReorder,
    onRowAction,
    onSelectionChange,
    onSortChange,
    renderEmptyState,
    rowHeight = 42,
    scrollContainerClassName,
    selectedKeys,
    selectionBehavior = 'toggle',
    selectionMode = 'none',
    showSelectionCheckboxes = false,
    sortDescriptor: sortDescriptorProp,
    treeColumn,
    treeIndent = 20,
    variant = 'primary',
    verticalAlign = 'middle',
    virtualized = false,
  } = props;

  const slots = useMemo(() => dataGridVariants({}), []);
  const [internalSortDescriptor, setInternalSortDescriptor] = useState<
    SortDescriptor | undefined
  >(defaultSortDescriptor);

  const isControlledSort = sortDescriptorProp !== undefined;
  const activeSortDescriptor = isControlledSort
    ? sortDescriptorProp
    : internalSortDescriptor;

  const sortedData = useMemo(() => {
    if (isControlledSort || !activeSortDescriptor?.column) return data;
    const col = columns.find((c) => c.id === activeSortDescriptor.column);
    if (!col) return data;
    return [...data].sort((a, b) => {
      let result: number;
      if (col.sortFn) {
        result = col.sortFn(a, b);
      } else {
        const key = col.accessorKey;
        if (!key) return 0;
        const valA = a[key];
        const valB = b[key];
        result =
          typeof valA === 'number' && typeof valB === 'number'
            ? valA - valB
            : String(valA ?? '').localeCompare(String(valB ?? ''));
      }
      return activeSortDescriptor.direction === 'descending' ? -result : result;
    });
  }, [data, activeSortDescriptor, columns, isControlledSort]);

  const hasSort = columns.some((c) => c.allowsSorting);
  const hasDnd = !!(onReorder || dragAndDropHooksProp);
  const pinnedInfo = useMemo(
    () =>
      computePinned(columns, showSelectionCheckboxes, selectionMode, hasDnd),
    [columns, showSelectionCheckboxes, selectionMode, hasDnd]
  );

  const tableRef = useRef<HTMLDivElement>(null);

  // Detach shadow classes for sticky columns on scroll
  useEffect(() => {
    if (!pinnedInfo) return;
    const el = tableRef.current;
    if (!el) return;
    const scrollContainer =
      el.querySelector('.table__resizable-container') ??
      el.querySelector('[data-slot="table-scroll-container"]');
    if (!scrollContainer) return;

    const onScroll = () => {
      const { clientWidth, scrollLeft, scrollWidth } =
        scrollContainer as HTMLElement;
      const left = Math.abs(scrollLeft);
      if (pinnedInfo.hasStartPinned)
        el.toggleAttribute('data-pinned-start-detached', left > 1);
      if (pinnedInfo.hasEndPinned)
        el.toggleAttribute(
          'data-pinned-end-detached',
          scrollWidth - clientWidth - left > 1
        );
    };

    onScroll();
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(scrollContainer);

    return () => {
      scrollContainer.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [pinnedInfo]);

  // Build DnD hooks
  const resolvedDndHooks = buildDndHooks(
    sortedData,
    getRowId,
    onReorder,
    dragAndDropHooksProp
  );

  // Determine tree column id
  const isTreeTable = typeof getChildren === 'function';
  const treeColumnId = useMemo(() => {
    if (!isTreeTable) return undefined;
    if (treeColumn) return treeColumn;
    const rowHeaderCol = columns.find((c) => c.isRowHeader);
    return rowHeaderCol?.id ?? columns[0]?.id;
  }, [isTreeTable, treeColumn, columns]);

  // Row renderer
  const renderRow = (item: T): React.ReactElement => {
    const rowId = getRowId(item);
    const children = isTreeTable ? (getChildren?.(item) ?? []) : [];
    const hasChildItems = isTreeTable && children.length > 0;

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
        {columns.map((col) => {
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
                  hasChildItems: hasChild,
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
                    {hasChild ? (
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
        })}
        {hasChildItems ? (
          <Table.Collection items={children}>
            {(child) => renderRow(child as T)}
          </Table.Collection>
        ) : null}
      </Table.Row>
    );
  };

  const tableContent = (
    <Table.Content
      aria-label={ariaLabel}
      className={contentClassName}
      defaultExpandedKeys={isTreeTable ? defaultExpandedKeys : undefined}
      defaultSelectedKeys={defaultSelectedKeys}
      disabledKeys={disabledKeys}
      dragAndDropHooks={resolvedDndHooks as any}
      expandedKeys={isTreeTable ? expandedKeys : undefined}
      selectedKeys={selectedKeys}
      selectionBehavior={selectionBehavior}
      selectionMode={selectionMode === 'none' ? undefined : selectionMode}
      sortDescriptor={activeSortDescriptor}
      treeColumn={isTreeTable ? treeColumnId : undefined}
      onExpandedChange={isTreeTable ? onExpandedChange : undefined}
      onRowAction={onRowAction}
      onSelectionChange={onSelectionChange}
      onSortChange={
        hasSort
          ? (descriptor) => {
              if (!isControlledSort) setInternalSortDescriptor(descriptor);
              onSortChange?.(descriptor);
            }
          : undefined
      }
    >
      <Table.Header className={virtualized ? 'h-full w-full' : undefined}>
        {showSelectionCheckboxes && selectionMode !== 'none' && (
          <Table.Column
            className={composeSlotClassName(slots?.selectionColumn, undefined)}
            data-pinned={pinnedInfo?.hasStartPinned ? 'start' : undefined}
            maxWidth={40}
            minWidth={40}
            style={
              pinnedInfo?.hasStartPinned ? { insetInlineStart: 0 } : undefined
            }
            width={40}
          >
            {selectionMode === 'multiple' ? (
              <Checkbox aria-label="Select all" slot="selection">
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
              </Checkbox>
            ) : null}
          </Table.Column>
        )}
        {hasDnd && (
          <Table.Column
            className={composeSlotClassName(slots?.dragHandleColumn, undefined)}
            data-pinned={pinnedInfo?.hasStartPinned ? 'start' : undefined}
            maxWidth={32}
            minWidth={32}
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
            width={32}
          />
        )}
        {columns.map((col) => {
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
        })}
      </Table.Header>
      <Table.Body
        renderEmptyState={
          renderEmptyState
            ? () => (
                <div
                  className={composeSlotClassName(slots?.emptyState, undefined)}
                  data-slot="data-grid-empty-state"
                >
                  {renderEmptyState()}
                </div>
              )
            : undefined
        }
      >
        <Table.Collection
          dependencies={[
            columns,
            showSelectionCheckboxes,
            selectionMode,
            hasDnd,
            isTreeTable,
            treeColumnId,
            treeIndent,
          ]}
          items={sortedData}
        >
          {(item) => renderRow(item)}
        </Table.Collection>
        {!!onLoadMore && (
          <Table.LoadMore isLoading={isLoadingMore} onLoadMore={onLoadMore}>
            <Table.LoadMoreContent>{loadMoreContent}</Table.LoadMoreContent>
          </Table.LoadMore>
        )}
      </Table.Body>
    </Table.Content>
  );

  const withResizing = allowsColumnResize ? (
    <Table.ResizableContainer
      onResize={onColumnResize}
      onResizeEnd={onColumnResizeEnd}
    >
      {tableContent}
    </Table.ResizableContainer>
  ) : (
    tableContent
  );

  const tableElement = (
    <Table
      ref={tableRef}
      className={composeSlotClassName(slots?.base, className)}
      data-slot="data-grid"
      data-vertical-align={verticalAlign}
      variant={variant}
    >
      <Table.ScrollContainer className={scrollContainerClassName}>
        {withResizing}
      </Table.ScrollContainer>
    </Table>
  );

  return (
    <DataGridContext value={{ slots }}>
      {virtualized ? (
        <Virtualizer
          layout={TableLayout}
          layoutOptions={{ headingHeight, rowHeight }}
        >
          {tableElement}
        </Virtualizer>
      ) : (
        tableElement
      )}
    </DataGridContext>
  );
};

DataGrid.displayName = 'HeroUI.DataGrid';

export type { Selection, SortDescriptor, SortDirection };
