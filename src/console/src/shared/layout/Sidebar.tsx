import { useEffect, useState } from 'react';
import type { ComponentType, MouseEvent, ReactNode, SVGProps } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LayoutSideContentLeft, ChevronDown } from '@gravity-ui/icons';
import { Avatar, Button, Dropdown, Label, Tooltip } from '@heroui/react';
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

export interface SidebarUser {
  username: string;
  role: string;
}

interface SidebarProps {
  brand?: string;
  collapsed: boolean;
  items: NavItem[];
  bottomItems?: NavItem[];
  /** Signed-in user card pinned below the bottom nav section. */
  user?: SidebarUser | null;
  onLogout?: () => void;
  onToggle: (v: boolean) => void;
}

function isLeafActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.to) return true;
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
  user,
  onLogout,
  onToggle,
}: SidebarProps) {
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
                    src="/images/icon2.webp"
                  />
                  <span className="text-2xl font-bold whitespace-nowrap text-neutral-900 dark:text-neutral-100 libre">
                    {brand}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
              <Button
                isIconOnly
                aria-label="Toggle sidebar"
                variant="ghost"
                onPress={() => onToggle(!collapsed)}
                className="absolute right-4 top-4 z-10 rounded-[15px]"
              >
                {collapsed ? (
                  <img
                    alt="icon"
                    className="w-8 h-8 object-cover dark:invert"
                    loading="lazy"
                    src="/images/icon2.webp"
                  />) : <LayoutSideContentLeft />}
              </Button>
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

          {user && (
            <div className="mt-2 pt-3 w-full shrink-0 border-t border-neutral-200 dark:border-neutral-800">
              <SidebarUserCard user={user} collapsed={collapsed} onLogout={onLogout} />
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// 鈹€鈹€ Desktop item 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
                variant={groupActive ? 'primary' : 'ghost'}
                className={`transition-all duration-300 ${groupActive ? 'rounded-[15px]' : ''}`}
                aria-label={label}
              >
                <item.icon className="shrink-0" />
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
                variant={groupActive ? 'primary' : 'ghost'}
                className={`flex-1 justify-start px-3 mr-1 transition-all duration-300 ${groupActive ? 'rounded-[15px]' : ''}`}
                onPress={handlePress}
              >
                <item.icon className="shrink-0" />
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

        {/* Children 鈥?animated collapse with a tree guide line */}
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
                        <child.icon className="ml-1 shrink-0" />
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
          variant={isActive ? 'primary' : 'ghost'}
          className={`flex-1 justify-start px-3 mr-1 transition-all duration-300 ${isActive ? 'rounded-[15px]' : ''}`}
          onPress={() => navigate(item.to)}
        >
          <item.icon className="shrink-0" />
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

function SidebarUserCard({
  user,
  collapsed,
  onLogout,
}: {
  user: SidebarUser;
  collapsed: boolean;
  onLogout?: () => void;
}) {
  const { t } = useTranslation();
  const initials = user.username.slice(0, 2).toUpperCase();
  return (
    <Dropdown>
      <Button
        variant="ghost"
        isIconOnly={collapsed}
        aria-label={user.username}
        className={collapsed
          ? 'rounded-[15px]'
          : 'w-full h-auto min-h-10 justify-start gap-3 rounded-[15px] px-2 py-1.5'}
      >
      <Avatar>
        <Avatar.Fallback delayMs={600}>{user.username.slice(0, 2).toUpperCase()}</Avatar.Fallback>
      </Avatar>
        {!collapsed && (
          <span className="flex min-w-0 flex-1 flex-col items-start">
            <span className="max-w-full truncate text-sm font-medium leading-tight text-neutral-900 dark:text-neutral-100">
              {user.username}
            </span>
            <span className="max-w-full truncate text-xs leading-tight text-neutral-500 dark:text-neutral-400">
              {user.role}
            </span>
          </span>
        )}
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            if (key === 'logout') onLogout?.();
          }}
        >
          <Dropdown.Item
            key="logout"
            id="logout"
            textValue={t('common.logout')}
            className="text-danger"
          >
            {t('common.logout')}
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

