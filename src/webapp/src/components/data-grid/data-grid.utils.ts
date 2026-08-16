import type { DragAndDropHooks } from 'react-aria-components/useDragAndDrop';
import { useDragAndDrop } from 'react-aria-components/useDragAndDrop';
import type { DataGridColumn, DataGridReorderEvent, PinnedInfo } from './data-grid.types';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function computePinned<T>(
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

export function reorderItems<T>(
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

export function buildDndHooks<T>(
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
