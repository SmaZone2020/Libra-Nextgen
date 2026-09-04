import { AppGridItem, type DrawerItem } from './AppGridItem';

/** One module of the app drawer: title + a 4-column square grid. */
export function AppGridSection({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: DrawerItem[];
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h3>
      <div className="grid grid-cols-4 gap-x-3 gap-y-4">
        {items.map((item) => (
          <AppGridItem key={item.id} item={item} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
