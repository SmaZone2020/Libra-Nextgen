import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { motion } from 'motion/react';
import { AppGridItem, type DrawerItem } from './AppGridItem';

/** One module of the app drawer: title + a 4-column square grid. In edit mode
 *  tiles can be dragged; hovering another tile swaps them live (row-major
 *  order), and releasing commits the new order via onReorder. */
export function AppGridSection({
  title,
  items,
  editing,
  onOpen,
  onLongPress,
  onReorder,
}: {
  title: string;
  items: DrawerItem[];
  editing: boolean;
  onOpen: (id: string) => void;
  onLongPress: () => void;
  onReorder: (items: DrawerItem[]) => void;
}) {
  const [localItems, setLocalItems] = useState(items);
  const draggedId = useRef<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const itemsRef = useRef(items);

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  useEffect(() => {
    itemsRef.current = localItems;
  }, [localItems]);

  // Editing state changes mid-gesture (long-press flips it on); only the
  // pointerdown that starts on the next press begins a drag.
  const dragActive = useRef(false);

  const handleDragStart = (e: PointerEvent<HTMLElement>) => {
    const cell = e.currentTarget.closest('[data-drawer-id]') as HTMLElement | null;
    const id = cell?.dataset.drawerId ?? null;
    if (!id || dragActive.current) return;
    dragActive.current = true;
    draggedId.current = id;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // nudge a11y state for the dragged tile
    setLocalItems((prev) => [...prev]);
  };

  const handleDragMove = (e: PointerEvent<HTMLElement>) => {
    const dragged = draggedId.current;
    if (!dragActive.current || !dragged) return;
    const { clientX: x, clientY: y } = e;
    for (const [id, el] of cellRefs.current) {
      if (id === dragged) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        if (id !== dragged) {
          setLocalItems((prev) => {
            const from = prev.findIndex((i) => i.id === dragged);
            const to = prev.findIndex((i) => i.id === id);
            if (from < 0 || to < 0 || from === to) return prev;
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            if (!moved) return prev;
            next.splice(to, 0, moved);
            return next;
          });
        }
        return;
      }
    }
  };

  const handleDragEnd = () => {
    if (!dragActive.current) return;
    dragActive.current = false;
    draggedId.current = null;
    onReorder(itemsRef.current);
  };

  const cells = useMemo(
    () =>
      localItems.map((item) => (
        <motion.div key={item.id} layout className="min-w-0">
          <div
            ref={(el) => {
              if (el) cellRefs.current.set(item.id, el);
              else cellRefs.current.delete(item.id);
            }}
            data-drawer-id={item.id}
          >
            <AppGridItem
              item={item}
              editing={editing}
              dragging={draggedId.current === item.id}
              onOpen={onOpen}
              onLongPress={onLongPress}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
            />
          </div>
        </motion.div>
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localItems, editing],
  );

  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h3>
      <div className="grid grid-cols-4 gap-x-3 gap-y-4">{cells}</div>
    </section>
  );
}
