import { useEffect, useState } from 'react';
import type { ComponentType, MouseEvent, ReactNode, SVGProps } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, LayoutSideContentLeft } from '@gravity-ui/icons';
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

/** A caption-keyed block of the sidebar. Omit `captionKey` for the unlabeled
 *  primary block (overview / agents / AI). */
export interface SidebarSection {
  captionKey?: string;
  items: NavItem[];
}

export interface SidebarUser {
  username: string;
  role: string;
}

interface SidebarProps {
  brand?: string;
  collapsed: boolean;
  sections: SidebarSection[];
  /** Signed-in user card pinned below the last section. */
  user?: SidebarUser | null;
  onLogout?: () => void;
  onToggle: (v: boolean) => void;
}

function isLeafActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.to) return true;
  return item.to.length > 1 && pathname.startsWith(item.to + '/');
}

/** Child rows only (dynamic plugin pages). */
function isChildActive(children: NavChild[], pathname: string): boolean {
  return children.some((c) => c.to === pathname || pathname.startsWith(c.to + '/'));
}

export function Sidebar({
  brand = 'Libra Next',
  collapsed,
  sections,
  user,
  onLogout,
  onToggle,
}: SidebarProps) {
  const { t } = useTranslation();

  return (
    <aside className="lw-sidebar">
      <div className="flex h-full min-h-0 flex-col p-4">
        {/* Brand row */}
        <div
          className={`mb-4 flex min-h-10 items-center ${
            collapsed ? 'justify-center' : 'justify-between gap-2 pr-1 pl-1.5'
          }`}
        >
          {!collapsed && (
            <div className="flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap">
              <img
                alt="icon"
                className="size-9 pointer-events-none shrink-0 rounded-[10px] object-cover select-none dark:invert"
                loading="lazy"
                src="/images/icon2.webp"
              />
              <span className="libre truncate text-[21px] leading-none font-bold whitespace-nowrap text-neutral-900 dark:text-neutral-100">
                {brand}
              </span>
            </div>
          )}
          <Button
            isIconOnly
            aria-label={t('nav.toggleSidebar')}
            variant="ghost"
            onPress={() => onToggle(!collapsed)}
            className={`shrink-0 rounded-[15px] ${collapsed ? 'size-10' : ''}`}
          >
            {collapsed ? (
              <img
                alt="icon"
                className="size-8 object-cover dark:invert"
                loading="lazy"
                src="/images/icon2.webp"
              />
            ) : (
              <LayoutSideContentLeft />
            )}
          </Button>
        </div>

        {/* Navigation rail */}
        <nav
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden ${collapsed ? 'mt-4' : 'mt-3'}`}
        >
          {sections.map((section, sectionIndex) => (
            <section
              key={section.captionKey ?? `primary-${sectionIndex}`}
              className={sectionIndex > 0 ? (collapsed ? 'mt-4' : 'mt-3') : ''}
            >
              {section.captionKey && !collapsed && (
                <div className="lw-nav-caption">{t(section.captionKey)}</div>
              )}
              {section.items.map((item) => (
                <DesktopNavItem key={item.label} item={item} collapsed={collapsed} />
              ))}
            </section>
          ))}
        </nav>

        {/* User card */}
        {user && (
          <div className="mt-2 w-full shrink-0 pt-3">
            <SidebarUserCard user={user} collapsed={collapsed} onLogout={onLogout} />
          </div>
        )}
      </div>
    </aside>
  );
}

// ───── Desktop item ────────────────────────────────────────────────────────

function DesktopNavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const hasChildren = !!item.children && item.children.length > 0;
  const childActive = hasChildren && isChildActive(item.children!, location.pathname);
  const selfActive = !hasChildren && isLeafActive(item, location.pathname);
  const [open, setOpen] = useState(childActive);

  // Auto-expand when navigating to a route owned by this group.
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  if (hasChildren) {
    const label = t(item.label);
    const navigable = !!item.to;
    const handlePress = () => {
      if (collapsed) return;
      if (navigable) navigate(item.to);
      else setOpen((v) => !v);
    };
    const handleChevron = (e: MouseEvent) => {
      e.stopPropagation();
      if (!collapsed) setOpen((v) => !v);
    };
    const groupActive = childActive || location.pathname === item.to;

    return (
      <div className="my-0.5 flex flex-col">
        <div className={`flex items-center ${collapsed ? 'justify-center' : ''}`}>
          {collapsed ? (
            <Dropdown>
              <Button
                variant="ghost"
                className={`shrink-0 rounded-[12px] p-0 ${
                  groupActive ? 'bg-accent-soft text-accent-soft-foreground' : ''
                }`}
                style={{ width: 40, height: 40 }}
                aria-label={label}
              >
                <item.icon className="m-auto size-4" />
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu aria-label={label} onAction={(key) => navigate(String(key))}>
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
                variant="ghost"
                className={`flex-1 justify-start rounded-[12px] px-3 ${
                  groupActive ? 'bg-accent-soft text-accent-soft-foreground' : ''
                }`}
                onPress={handlePress}
              >
                <item.icon className="shrink-0" />
                <span
                  className={`flex-1 overflow-hidden whitespace-nowrap text-left ${
                    groupActive ? 'font-semibold' : 'font-medium'
                  }`}
                  style={{ maxWidth: collapsed ? 0 : '14rem', opacity: collapsed ? 0 : 1 }}
                >
                  {label}
                </span>
                <span
                  onClick={handleChevron}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="ml-1 shrink-0 cursor-pointer rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
                  aria-label={t('nav.toggleGroup')}
                  role="button"
                >
                  <motion.span
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="block"
                  >
                    <ChevronDown className="size-4" />
                  </motion.span>
                </span>
              </Button>
              <Tooltip.Content placement="right">{label}</Tooltip.Content>
            </Tooltip>
          )}
        </div>

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
              <div className="ml-[22px] flex flex-col gap-0.5 border-l border-neutral-200 py-1 pl-2 dark:border-neutral-700">
                {item.children!.map((child) => {
                  const isActive =
                    location.pathname === child.to ||
                    (child.to.length > 1 && location.pathname.startsWith(child.to + '/'));
                  const childLabel = t(child.label);
                  return (
                    <div key={child.to} className="mb-[2px] flex items-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={`flex-1 justify-start rounded-[10px] px-2 transition-all duration-200 ${
                          isActive ? 'bg-accent-soft text-accent-soft-foreground' : ''
                        }`}
                        onPress={() => navigate(child.to)}
                      >
                        <child.icon className="ml-1 shrink-0" />
                        <span className={`truncate text-[15px] ${isActive ? 'font-semibold' : 'font-medium'}`}>
                          {childLabel}
                        </span>
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
  const isActive = selfActive;
  const label = t(item.label);
  return (
    <div className={`my-0.5 flex items-center ${collapsed ? 'justify-center' : ''}`}>
      <Tooltip delay={0} isDisabled={!collapsed}>
        <Button
          variant="ghost"
          className={`justify-start rounded-[12px] ${
            collapsed ? 'shrink-0 p-0' : 'flex-1 px-3'
          } ${isActive ? 'bg-accent-soft text-accent-soft-foreground' : ''}`}
          style={collapsed ? { width: 40, height: 40 } : undefined}
          onPress={() => navigate(item.to)}
        >
          <item.icon className={collapsed ? 'm-auto size-4' : 'shrink-0'} />
          {!collapsed && (
            <span
              className={`overflow-hidden whitespace-nowrap ${
                isActive ? 'font-semibold' : 'font-medium'
              }`}
            >
              {label}
            </span>
          )}
        </Button>
        <Tooltip.Content placement="right">{label}</Tooltip.Content>
      </Tooltip>
    </div>
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
          : 'h-auto min-h-10 w-full justify-start gap-3 rounded-[15px] px-2 py-1.5'}
      >
        <Avatar>
          <Avatar.Fallback delayMs={600}>{initials}</Avatar.Fallback>
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
