import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { sidebarSections } from '../../config/site';
import { useRegisteredPlugins } from '../../plugins/registry';
import { resolvePluginIcon } from '../../plugins/icons';
import { canSeeRoute } from '../../utils/permissions';
import { AppGridSection } from './AppGridSection';
import type { DrawerItem } from './AppGridItem';
import type { NavItem } from '../../shared/layout/Sidebar';
import type { UserPermissions } from '../../types/models';

/** Feishu-style app drawer for mobile: workspace + operations modules on top
 *  of each other. Tapping a tile opens the app and closes the drawer. */
export function AppDrawer({
  open,
  onClose,
  permissions,
}: {
  open: boolean;
  onClose: () => void;
  permissions: UserPermissions | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const workspaceSection = sidebarSections.find((s) => s.captionKey === 'nav.section.workspace');
  const operationsSection = sidebarSections.find((s) => s.captionKey === 'nav.section.operations');

  const toDrawerItems = useMemo(() => {
    return (items: NavItem[]): DrawerItem[] =>
      items
        .filter((i) => canSeeRoute(permissions, i.to))
        .map((i) => ({ id: i.to, label: t(i.label), icon: i.icon }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions]);

  const workspaceItems = useMemo(
    () => (workspaceSection ? toDrawerItems(workspaceSection.items) : []),
    [workspaceSection, toDrawerItems],
  );

  const operationsItems = useMemo(
    () => (operationsSection ? toDrawerItems(operationsSection.items) : []),
    [operationsSection, toDrawerItems],
  );

  const pluginsVisible = canSeeRoute(permissions, '/plugins');
  const registeredPlugins = useRegisteredPlugins();
  const pluginItems = useMemo<DrawerItem[]>(
    () =>
      pluginsVisible
        ? registeredPlugins.map((p) => ({
            id: p.route,
            label: p.manifest.name || p.pluginId,
            icon: resolvePluginIcon(p.manifest.entry?.icon),
          }))
        : [],
    [pluginsVisible, registeredPlugins],
  );

  const handleOpen = (id: string) => {
    navigate(id);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <motion.button
            aria-label={t('common.close')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-default bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t('mobile.apps')}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="absolute inset-x-0 bottom-0 max-h-[78vh] overflow-y-auto rounded-t-3xl border-t border-neutral-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
            <h2 className="mb-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {t('mobile.apps')}
            </h2>
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              {t('mobile.appsHint')}
            </p>

            <div className="space-y-5">
              {workspaceItems.length > 0 && (
                <AppGridSection
                  title={t('nav.section.workspace')}
                  items={workspaceItems}
                  onOpen={handleOpen}
                />
              )}
              {operationsItems.length > 0 && (
                <AppGridSection
                  title={t('nav.section.operations')}
                  items={operationsItems}
                  onOpen={handleOpen}
                />
              )}
              {pluginItems.length > 0 && (
                <AppGridSection title={t('nav.plugins')} items={pluginItems} onOpen={handleOpen} />
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
