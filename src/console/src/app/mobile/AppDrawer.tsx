import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@heroui/react';
import { sidebarItems } from '../../config/site';
import { useRegisteredPlugins } from '../../plugins/registry';
import { resolvePluginIcon } from '../../plugins/icons';
import { canSeeRoute } from '../../utils/permissions';
import { AppGridSection } from './AppGridSection';
import { applyDrawerOrder, useDrawerOrder } from './useAppDrawerOrder';
import type { DrawerItem } from './AppGridItem';
import type { UserPermissions } from '../../types/models';

const STORAGE_KEY = 'libra.mobile.appDrawer.v1';

/** Feishu-style app drawer for mobile: features + plugins modules on top of
 *  each other. Tap opens an app; long-press (or the Sort button) enters edit
 *  mode where tiles can be dragged to reorder (persisted locally). */
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
  const [editing, setEditing] = useState(false);
  const { order, setSectionOrder } = useDrawerOrder(STORAGE_KEY);

  // Leave edit mode whenever the drawer closes so it never reopens mid-sort.
  useEffect(() => {
    if (!open) setEditing(false);
  }, [open]);

  const featuresGroup = sidebarItems.find((i) => i.label === 'nav.features');
  const featureDefaults = useMemo<DrawerItem[]>(
    () =>
      (featuresGroup?.children ?? [])
        .filter((c) => canSeeRoute(permissions, c.to))
        .map((c) => ({ id: c.to, label: t(c.label), icon: c.icon })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [featuresGroup, permissions],
  );

  const pluginsVisible = canSeeRoute(permissions, '/plugins');
  const registeredPlugins = useRegisteredPlugins();
  const pluginDefaults = useMemo<DrawerItem[]>(
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

  const featureItems = useMemo(
    () => applyDrawerOrder(featureDefaults, order.features),
    [featureDefaults, order.features],
  );
  const pluginItems = useMemo(
    () => applyDrawerOrder(pluginDefaults, order.plugins),
    [pluginDefaults, order.plugins],
  );

  const handleOpen = (id: string) => {
    setEditing(false);
    navigate(id);
    onClose();
  };

  const handleLongPress = () => {
    if (!editing) setEditing(true);
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
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                {t('mobile.apps')}
              </h2>
              {editing ? (
                <Button size="sm" variant="secondary" onPress={() => setEditing(false)}>
                  {t('mobile.sortDone')}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" isDisabled={featureItems.length + pluginItems.length === 0} onPress={() => setEditing(true)}>
                  {t('mobile.sort')}
                </Button>
              )}
            </div>
            {!editing && (
              <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">{t('mobile.sortHint')}</p>
            )}

            <div className="space-y-5">
              <AppGridSection
                title={t('nav.features')}
                items={featureItems}
                editing={editing}
                onOpen={handleOpen}
                onLongPress={handleLongPress}
                onReorder={(items) => setSectionOrder('features', items.map((i) => i.id))}
              />
              <AppGridSection
                title={t('nav.plugins')}
                items={pluginItems}
                editing={editing}
                onOpen={handleOpen}
                onLongPress={handleLongPress}
                onReorder={(items) => setSectionOrder('plugins', items.map((i) => i.id))}
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
