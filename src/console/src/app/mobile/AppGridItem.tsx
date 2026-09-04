import type { ReactNode, SVGProps, ComponentType } from 'react';

export interface DrawerItem {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>> | (() => ReactNode);
}

/** A single square app tile in the drawer; tapping it opens the app. */
export function AppGridItem({
  item,
  onOpen,
}: {
  item: DrawerItem;
  onOpen: (id: string) => void;
}) {
  const Icon = item.icon as ComponentType<SVGProps<SVGSVGElement>>;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(item.id);
      }}
      className="flex w-full cursor-pointer flex-col items-center gap-1 outline-none select-none"
    >
      <span className="flex aspect-square w-full items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-100 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-800/70 dark:text-neutral-200">
        <Icon className="size-6" />
      </span>
      <span className="w-full truncate text-center text-[11px] leading-tight text-neutral-600 dark:text-neutral-400">
        {item.label}
      </span>
    </div>
  );
}
