import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

// A plugin route is any path under /plugins/ except the management page itself.
export const isPluginRoute = (pathname: string) =>
  pathname.startsWith('/plugins/') && pathname !== '/plugins';

const PAGE_META_KEYS: Record<string, [string, string]> = {
  '/': ['pageMeta.dashboard.label', 'pageMeta.dashboard.subtitle'],
  '/agents': ['pageMeta.agents.label', 'pageMeta.agents.subtitle'],
  '/shell': ['pageMeta.shell.label', 'pageMeta.shell.subtitle'],
  '/files': ['pageMeta.explorer.label', 'pageMeta.explorer.subtitle'],
  '/system': ['pageMeta.system.label', 'pageMeta.system.subtitle'],
  '/othersoft': ['pageMeta.othersoft.label', 'pageMeta.othersoft.subtitle'],
  '/proxy': ['pageMeta.proxyBrowser.label', 'pageMeta.proxyBrowser.subtitle'],
  '/builder': ['pageMeta.builder.label', 'pageMeta.builder.subtitle'],
  '/audit': ['pageMeta.audit.label', 'pageMeta.audit.subtitle'],
  '/about': ['pageMeta.about.label', 'pageMeta.about.subtitle'],
  '/ai': ['pageMeta.ai.label', 'pageMeta.ai.subtitle'],
  '/ai/:sessionId': ['pageMeta.ai.label', 'pageMeta.ai.subtitle'],
  '/settings': ['pageMeta.settings.label', 'pageMeta.settings.subtitle'],
  '/plugins': ['pageMeta.plugins.label', 'pageMeta.plugins.subtitle'],
  '/settings/preferences': ['pageMeta.settings.label', 'pageMeta.settings.subtitle'],
  '/settings/security': ['pageMeta.settings.label', 'pageMeta.settings.subtitle'],
  '/settings/accessKeys': ['pageMeta.settings.label', 'pageMeta.settings.subtitle'],
  '/settings/account': ['pageMeta.settings.label', 'pageMeta.settings.subtitle'],
  '/settings/mcp': ['pageMeta.settings.label', 'pageMeta.settings.subtitle'],
  '/settings/riskPolicy': ['pageMeta.settings.label', 'pageMeta.settings.subtitle'],
};

export function PageHeader({ pluginLabels }: { pluginLabels: Map<string, string> }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const keys = PAGE_META_KEYS[pathname]
    ?? (pathname.startsWith('/ai/') ? PAGE_META_KEYS['/ai'] : undefined);
  // Plugin pages resolve their heading from the enabled manifest name.
  const pluginName = isPluginRoute(pathname) ? pluginLabels.get(pathname) : undefined;
  if (!keys && !pluginName) return null;
  return (
    <motion.div
      key={pathname}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      initial={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <h1 className="mt-0.5 text-xl font-semibold tracking-normal text-neutral-950 dark:text-neutral-50">
        {pluginName ? pluginName : t(keys![0])}
      </h1>
      <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">
        {location.pathname !== '/plugins'
          ? ""
            : pluginName
              ? t('plugins.desc')
              : t(keys![1])}
      </p>
    </motion.div>
  );
}
