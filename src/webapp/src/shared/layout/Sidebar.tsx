import { useEffect, useState } from 'react';
import type { ComponentType, MouseEvent, ReactNode, SVGProps } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LayoutSideContentLeft, ChevronDown } from '@gravity-ui/icons';
import { Button, Dropdown, Label, Tooltip } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

export interface NavChild {
  icon: ComponentType<SVGProps<SVGSVGElement>> | (() => ReactNode);
  to: string;
  label: string;
}

export interface NavItem {
  icon: ComponentType<SVGProps<SVGSVGElement>> | (() => ReactNode);
  /** Route for a leaf item. For a group (with children), `to` is ignored. */
  to: string;
  label: string;
  /** When present, this item becomes a collapsible parent folder. */
  children?: NavChild[];
}

interface SidebarProps {
  brand?: string;
  collapsed: boolean;
  items: NavItem[];
  bottomItems?: NavItem[];
  onToggle: (v: boolean) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

/** 叶子项激活判断：精确匹配，或 /ai 等“详情子路由”前缀匹配（/ai/xxx 保持高亮）。 */
function isLeafActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.to) return true;
  // 导航项自身是父级路由（如 /ai），其下的详情子路由同样视为激活。
  return item.to.length > 1 && pathname.startsWith(item.to + '/');
}

/** Recursively collect the routes contained by an item (incl. its children and
 *  the item's own `to` when it is a navigable group). */
function collectRoutes(item: NavItem): string[] {
  const routes: string[] = [];
  if (item.to) routes.push(item.to);
  if (item.children && item.children.length > 0) {
    routes.push(...item.children.map((c) => c.to));
  }
  return routes;
}

/** True when any route inside the item matches the current pathname. */
function isGroupActive(item: NavItem, pathname: string): boolean {
  return collectRoutes(item).some((r) => r === pathname);
}

export function Sidebar({
  brand = 'Libra Nextgen',
  collapsed,
  items,
  bottomItems,
  onToggle,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-40 hidden sm:block
        transition-all duration-300 ease-in-out bg-white border-r border-neutral-200 dark:bg-neutral-900 dark:border-neutral-800
        ${collapsed ? 'w-18' : 'w-64'}`}
      >
        <div className="flex flex-col h-full p-4 overflow-hidden">
          <div
            className={`flex items-center mb-6 transition-all duration-300 ${
              collapsed ? '' : 'justify-between'
              //justify-center
            }`}
          >
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  initial={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                  className="flex items-center gap-2 overflow-hidden whitespace-nowrap"
                >
                  <img
                    alt="icon"
                    className="h-[50px] w-[50px] pointer-events-none object-cover select-none dark:invert"
                    loading="lazy"
                    src="/images/icon.webp"
                  />
                  <span className="text-2xl font-bold whitespace-nowrap text-neutral-900 dark:text-neutral-100 libre">
                    {brand}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            <Tooltip delay={0} >
              <Button
                isIconOnly
                aria-label="Toggle sidebar"
                variant="ghost"
                onPress={() => onToggle(!collapsed)}
                className="absolute right-4 top-4 z-10"
              >
                {collapsed ? (        
                  <img
                    alt="icon"
                    className="w-8 h-8 object-cover dark:invert"
                    loading="lazy"
                    src="/images/icon2.webp"
                  />) : <LayoutSideContentLeft className="w-5 h-5" />}
              </Button>
              <Tooltip.Content>
                <p>{collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}</p>
              </Tooltip.Content>
            </Tooltip>
          </div>

          <motion.nav
            className={`flex-1 flex flex-col gap-1 overflow-y-auto overflow-x-hidden ${collapsed ? 'mt-4' : ''}`}
            transition={{ layout: { staggerChildren: 0.05 } }}
          >
            {items.map((item) => (
              <DesktopNavItem key={item.label} item={item} collapsed={collapsed} />
            ))}
          </motion.nav>

          <motion.div
            layout
            className="pt-4 border-t border-neutral-200 dark:border-neutral-800 w-full space-y-2 overflow-y-auto overflow-x-hidden"
          >
            {bottomItems?.map((item) => (
              <DesktopNavItem key={item.label} item={item} collapsed={collapsed} />
            ))}
          </motion.div>
        </div>
      </aside>

      {/* Mobile overlay sidebar */}
      {mobileOpen && (
        <div
          className="sm:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-50 sm:hidden
          transition-transform duration-300 ease-in-out bg-white border-r border-neutral-200 dark:bg-neutral-900 dark:border-neutral-800
          w-64 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex flex-col h-full p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 libre">{brand}</span>
            <Tooltip delay={0}>
              <Button isIconOnly aria-label="Close sidebar" size="sm" variant="ghost" onPress={onMobileClose}>
                <LayoutSideContentLeft className="w-5 h-5" />
              </Button>
              <Tooltip.Content>
                <p>{t('nav.collapseSidebar')}</p>
              </Tooltip.Content>
            </Tooltip>
          </div>

          <nav className="flex-1 flex flex-col gap-1 overflow-y-auto">
            {items.map((item) => (
              <MobileNavItem key={item.label} item={item} onNavigate={onMobileClose} />
            ))}
          </nav>

          <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-2 overflow-y-auto">
            {bottomItems?.map((item) => (
              <MobileNavItem key={item.label} item={item} onNavigate={onMobileClose} />
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Desktop item ────────────────────────────────────────────────────────

function DesktopNavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const hasChildren = !!item.children && item.children.length > 0;
  const [open, setOpen] = useState(isGroupActive(item, location.pathname));
  const groupActive = hasChildren && isGroupActive(item, location.pathname);

  // Auto-expand when navigating to a route owned by this group (e.g. the
  // navigable /plugins route or one of its children).
  useEffect(() => {
    if (isGroupActive(item, location.pathname)) {
      setOpen(true);
    }
  }, [item, location.pathname]);

  if (hasChildren) {
    const label = t(item.label);
    // A "navigable" group navigates to item.to on body click; the chevron
    // (nested inside the button, right side) toggles children. For a
    // non-navigable group, the whole button toggles children.
    const navigable = !!item.to;
    const handlePress = () => {
      if (collapsed) {
        // 收缩态：点击由外层 Dropdown 接管，弹出子项菜单（不展开侧边栏）。
        return;
      }
      if (navigable) {
        if (item.to) navigate(item.to);
      } else {
        setOpen((v) => !v);
      }
    };
    const handleChevron = (e: MouseEvent) => {
      e.stopPropagation();
      if (collapsed) {
        return;
      }
      setOpen((v) => !v);
    };
    return (
      <div className="flex flex-col">
        <motion.div layout className="flex items-center">
          {collapsed ? (
            <Dropdown>
              <Button
                isIconOnly
                size="lg"
                variant={groupActive ? 'primary' : 'ghost'}
                className={`transition-all duration-300 ${groupActive ? 'rounded-[15px]' : ''}`}
                aria-label={label}
              >
                <item.icon className="w-5 h-5 shrink-0" />
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label={label}
                  onAction={(key) => navigate(String(key))}
                >
                  {item.children!.map((child) => {
                    const childLabel = t(child.label);
                    return (
                      <Dropdown.Item key={child.to} id={child.to} textValue={childLabel}>
                        <child.icon className="size-4 shrink-0 text-muted" />
                        <Label>{childLabel}</Label>
                      </Dropdown.Item>
                    );
                  })}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          ) : (
            <Tooltip delay={0}>
              <Button
                size="lg"
                variant={groupActive ? 'primary' : 'ghost'}
                className={`flex-1 justify-start px-3 mr-1 transition-all duration-300 ${groupActive ? 'rounded-[15px]' : ''}`}
                onPress={handlePress}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span
                  className="overflow-hidden whitespace-nowrap transition-all duration-300 font-medium flex-1 text-left"
                  style={{ maxWidth: collapsed ? 0 : '14rem', opacity: collapsed ? 0 : 1 }}
                >
                  {label}
                </span>
                <span
                  onClick={handleChevron}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`shrink-0 -mr-1 ml-1 rounded p-0.5 cursor-pointer ${
                    groupActive
                      ? 'text-white'
                      : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
                  }`}
                  aria-label={t('nav.toggleGroup')}
                  role="button"
                >
                  <motion.span
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="block"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </motion.span>
                </span>
              </Button>
              <Tooltip.Content placement="right">{label}</Tooltip.Content>
            </Tooltip>
          )}
          <AnimatePresence>
            {groupActive && !collapsed && (
              <motion.div
                animate={{ width: 8, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                initial={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="h-6 bg-blue-500 shrink-0 rounded-md"
              />
            )}
          </AnimatePresence>
        </motion.div>

        {/* Children — animated collapse with a tree guide line */}
        <AnimatePresence initial={false}>
          {open && !collapsed && (
            <motion.ul
              key="children"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="ml-[22px] pl-2 border-l border-neutral-200 dark:border-neutral-700 flex flex-col gap-0.5 py-1">
                {item.children!.map((child) => {
                  const isActive = location.pathname === child.to;
                  const childLabel = t(child.label);
                  return (
                    <div key={child.to} className="flex mb-[2px] items-center">
                      <Button
                        size="sm"
                        variant={isActive ? 'primary' : 'ghost'}
                        className={`flex-1 justify-start px-2 mr-1 transition-all duration-200 ${isActive ? 'rounded-[12px]' : ''}`}
                        onPress={() => navigate(child.to)}
                      >
                        <child.icon className="ml-1 w-5 h-5 shrink-0" />
                        <span className="text-[15px] truncate">{childLabel}</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Leaf item
  const isActive = isLeafActive(item, location.pathname);
  const label = t(item.label);
  return (
    <motion.div layout className="flex items-center">
      <Tooltip delay={0} isDisabled={!collapsed}>
        <Button
          isIconOnly={collapsed}
          size="lg"
          variant={isActive ? 'primary' : 'ghost'}
          className={`flex-1 justify-start px-3 mr-1 transition-all duration-300 ${isActive ? 'rounded-[15px]' : ''}`}
          onPress={() => navigate(item.to)}
        >
          <item.icon className="w-5 h-5 shrink-0" />
          <span
            className="overflow-hidden whitespace-nowrap transition-all duration-300 font-medium "
            style={{ maxWidth: collapsed ? 0 : '14rem', opacity: collapsed ? 0 : 1 }}
          >
            {label}
          </span>
        </Button>
        <Tooltip.Content placement="right">{label}</Tooltip.Content>
      </Tooltip>
      <AnimatePresence>
        {isActive && (
          <motion.div
            animate={{ width: 8, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            initial={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="h-6 bg-blue-500 shrink-0 rounded-md"
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Mobile item ─────────────────────────────────────────────────────────

function MobileNavItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const hasChildren = !!item.children && item.children.length > 0;
  const [open, setOpen] = useState(isGroupActive(item, location.pathname));
  const groupActive = hasChildren && isGroupActive(item, location.pathname);

  // Auto-expand when navigating to a route owned by this group.
  useEffect(() => {
    if (isGroupActive(item, location.pathname)) {
      setOpen(true);
    }
  }, [item, location.pathname]);

  if (hasChildren) {
    const label = t(item.label);
    const navigable = !!item.to;
    const handleBody = () => {
      if (navigable && item.to) {
        navigate(item.to);
        onNavigate();
      } else {
        setOpen((v) => !v);
      }
    };
    const handleChevron = (e: MouseEvent) => {
      e.stopPropagation();
      setOpen((v) => !v);
    };
    return (
      <div>
        <div className="flex items-center">
          <Button
            size="lg"
            variant={groupActive ? 'primary' : 'ghost'}
            className={`flex-1 justify-start px-3 mr-1 ${groupActive ? 'rounded-[15px]' : ''}`}
            onPress={handleBody}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            <span className="font-medium ml-3 flex-1 text-left">{label}</span>
            <span
              onClick={handleChevron}
              onPointerDown={(e) => e.stopPropagation()}
              className={`shrink-0 ml-1 rounded p-0.5 cursor-pointer ${
                groupActive
                  ? 'text-white'
                  : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
              aria-label={t('nav.toggleGroup')}
              role="button"
            >
              <motion.span
                animate={{ rotate: open ? 180 : 0 }}
                transition={{ duration: 0.25 }}
                className="block"
              >
                <ChevronDown className="w-4 h-4" />
              </motion.span>
            </span>
          </Button>
          {groupActive && <div className="h-6 w-2 bg-blue-500 shrink-0 rounded-md" />}
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="children"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="ml-[22px] pl-2 border-l border-neutral-200 dark:border-neutral-700 flex flex-col gap-0.5 py-1">
                {item.children!.map((child) => {
                  const isActive = location.pathname === child.to;
                  return (
                    <Button
                      key={child.to}
                      size="sm"
                      variant={isActive ? 'primary' : 'ghost'}
                      className={`justify-start px-2 ${isActive ? 'rounded-[12px]' : ''}`}
                      onPress={() => { navigate(child.to); onNavigate(); }}
                    >
                      <child.icon className="w-4 h-4 shrink-0" />
                      <span className="ml-2 text-sm truncate">{t(child.label)}</span>
                    </Button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Leaf
  const isActive = isLeafActive(item, location.pathname);
  const label = t(item.label);
  return (
    <div className="flex items-center">
      <Button
        size="lg"
        variant={isActive ? 'primary' : 'ghost'}
        className={`flex-1 justify-start px-3 mr-1 ${isActive ? 'rounded-[15px]' : ''}`}
        onPress={() => { navigate(item.to); onNavigate(); }}
      >
        <item.icon className="w-5 h-5 shrink-0" />
        <span className="font-medium ml-3">{label}</span>
      </Button>
      {isActive && <div className="h-6 w-2 bg-blue-500 shrink-0 rounded-md" />}
    </div>
  );
}

