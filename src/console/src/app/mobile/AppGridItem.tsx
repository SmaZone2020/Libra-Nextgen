import { useRef } from 'react';
import type { ReactNode, SVGProps, ComponentType, PointerEvent } from 'react';

export interface DrawerItem {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>> | (() => ReactNode);
}

const LONG_PRESS_MS = 600;
const DRAG_DEADZONE_PX = 8;

/** A single square app tile. Tap opens the app; a long press (or being in
 *  edit mode) enables pointer-based dragging for grid reordering. */
export function AppGridItem({
  item,
  editing,
  dragging,
  onOpen,
  onLongPress,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: DrawerItem;
  editing: boolean;
  dragging: boolean;
  onOpen: (id: string) => void;
  onLongPress: () => void;
  onDragStart: (e: PointerEvent<HTMLElement>) => void;
  onDragMove: (e: PointerEvent<HTMLElement>) => void;
  onDragEnd: (e: PointerEvent<HTMLElement>) => void;
}) {
  const timer = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const handlePointerDown = (e: PointerEvent<HTMLElement>) => {
    startPos.current = { x: e.clientX, y: e.clientY };
    if (editing) {
      onDragStart(e);
      return;
    }
    clearTimer();
    timer.current = window.setTimeout(() => {
      navigator.vibrate?.(15);
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const start = startPos.current;
    if (editing) {
      onDragMove(e);
      return;
    }
    // Scrolling the drawer must cancel a pending long-press.
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_DEADZONE_PX) {
      clearTimer();
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLElement>) => {
    clearTimer();
    startPos.current = null;
    if (editing) onDragEnd(e);
  };

  const Icon = item.icon as ComponentType<SVGProps<SVGSVGElement>>;

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={() => {
        clearTimer();
        if (!editing) onOpen(item.id);
      }}
      onKeyDown={(e) => {
        if (!editing && (e.key === 'Enter' || e.key === ' ')) onOpen(item.id);
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: editing ? 'none' : 'pan-y' }}
      className={`flex w-full cursor-pointer flex-col items-center gap-1 outline-none select-none ${
        dragging ? 'opacity-90' : ''
      }`}
    >
      <span
        className={`flex aspect-square w-full items-center justify-center rounded-2xl border transition-colors ${
          editing
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-neutral-200 bg-neutral-100 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-800/70 dark:text-neutral-200'
        } ${dragging ? 'shadow-lg' : ''}`}
      >
        <Icon className="size-6" />
      </span>
      <span className="w-full truncate text-center text-[11px] leading-tight text-neutral-600 dark:text-neutral-400">
        {item.label}
      </span>
    </div>
  );
}
