'use client';

import type { ReactNode } from 'react';
import React from 'react';
import {
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Checkbox,
  Table,
} from '@heroui/react';
import type { SortDescriptor } from 'react-aria-components/Table';
import { TableLayout, Virtualizer } from 'react-aria-components/Virtualizer';
import { composeSlotClassName } from '../../utils/compose';
import { dataGridVariants } from './data-grid.styles';
import { DataGridContext } from './data-grid-header';
import { DataGridHeaderColumn } from './data-grid-header';
import { DataGridRow } from './data-grid-row';
import { buildDndHooks, computePinned } from './data-grid.utils';
import type { DataGridColumn, DataGridProps } from './data-grid.types';
import type { DataGridSlots } from './data-grid.types';

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

  const slots: DataGridSlots = useMemo(() => dataGridVariants({}), []);
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

  // HeroUI's Table.Collection requires each item to have an `id` property.
  // Inject `id` via getRowId so the collection builder can determine keys.
  const collectionItems = useMemo(
    () => sortedData.map((item) => ({ ...item, id: getRowId(item) })),
    [sortedData, getRowId],
  );

  const hasSort = columns.some((c) => c.allowsSorting);
  const hasDnd = !!(onReorder || dragAndDropHooksProp);
  const pinnedInfo = useMemo(
    () =>
      computePinned(columns, showSelectionCheckboxes, selectionMode, hasDnd),
    [columns, showSelectionCheckboxes, selectionMode, hasDnd]
  );

  const tableRef = useRef<HTMLDivElement>(null);

  // Detach shadow classes for sticky columns on scroll
  React.useEffect(() => {
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
        {columns.map((col) => (
          <DataGridHeaderColumn
            allowsColumnResize={allowsColumnResize}
            col={col}
            key={col.id}
            pinnedInfo={pinnedInfo}
            slots={slots}
          />
        ))}
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
          items={collectionItems}
        >
          {(item) => (
            <DataGridRow
              columns={columns}
              getChildren={getChildren}
              getRowId={getRowId}
              hasDnd={hasDnd}
              isTreeTable={isTreeTable}
              item={item}
              pinnedInfo={pinnedInfo}
              selectionMode={selectionMode}
              showSelectionCheckboxes={showSelectionCheckboxes}
              slots={slots}
              treeColumnId={treeColumnId}
              treeIndent={treeIndent}
            />
          )}
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

export type { DataGridColumn, DataGridProps, DataGridReorderEvent, ColumnSize } from './data-grid.types';
export type { Selection, SortDescriptor, SortDirection } from 'react-aria-components';
