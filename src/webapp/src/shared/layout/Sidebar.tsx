import type { ComponentType, ReactNode, SVGProps } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bars, Globe, Xmark } from '@gravity-ui/icons';
import { Button, Dropdown, Label, Tooltip } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { switchLang } from '../../i18n';
import { useLocation, useNavigate } from 'react-router-dom';

interface NavItem {
  icon: ComponentType<SVGProps<SVGSVGElement>> | (() => ReactNode);
  to: string;
  label: string;
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

export function Sidebar({
  brand = 'HeroUI',
  collapsed,
  items,
  bottomItems,
  onToggle,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-40 hidden sm:block
        transition-all duration-300 ease-in-out bg-white border-r border-neutral-200
        ${collapsed ? 'w-18' : 'w-64'}`}
      >
        <div className="flex flex-col h-full p-4">
          <div
            className={`flex items-center mb-6 transition-all duration-300 ${
              collapsed ? 'justify-center' : 'justify-between'
            }`}
          >
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  initial={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <span className="text-2xl font-bold whitespace-nowrap block text-neutral-900 mx-auto libre">
                    {brand}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            <Tooltip delay={0}>
              <Button
                isIconOnly
                aria-label="Toggle sidebar"
                size="sm"
                variant="ghost"
                onPress={() => onToggle(!collapsed)}
              >
                {collapsed ? <Bars className="w-5 h-5" /> : <Xmark className="w-5 h-5" />}
              </Button>
              <Tooltip.Content>
                <p>{collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}</p>
              </Tooltip.Content>
            </Tooltip>
          </div>

          <motion.nav
            layout
            className="flex-1 flex flex-col gap-1"
            transition={{ layout: { staggerChildren: 0.08 } }}
          >
            {items.map((item) => {
              const isActive = location.pathname === item.to;
              const label = t(item.label);
              return (
                <motion.div key={item.to} layout className="flex items-center">
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
                        style={{
                          maxWidth: collapsed ? 0 : '14rem',
                          opacity: collapsed ? 0 : 1,
                        }}
                      >
                        {label}
                      </span>
                    </Button>
                    <Tooltip.Content showArrow placement="right">
                      {label}
                    </Tooltip.Content>
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
            })}
          </motion.nav>

          <motion.div
            layout
            className="pt-4 border-t border-neutral-200 w-full space-y-2"
          >
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.p
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-xs text-neutral-500 px-3 truncate"
                >
                  {t('nav.pages', { count: items.length })}
                </motion.p>
              )}
            </AnimatePresence>

            {bottomItems?.map((item) => {
              const label = t(item.label);
              const isActive = location.pathname === item.to;
              return (
                <motion.div key={item.to} layout className="flex items-center">
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
                        style={{
                          maxWidth: collapsed ? 0 : '14rem',
                          opacity: collapsed ? 0 : 1,
                        }}
                      >
                        {label}
                      </span>
                    </Button>
                    <Tooltip.Content showArrow placement="right">
                      {label}
                    </Tooltip.Content>
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
            })}

            <motion.div layout className="flex justify-center px-1">
              <Dropdown>
                <Button
                  isIconOnly={collapsed}
                  size="sm"
                  variant="ghost"
                  aria-label={t('nav.toggleSidebar')}
                  className={collapsed ? 'h-9 w-9' : 'flex-1 justify-start px-3'}
                >
                  <Globe className="w-4 h-4 shrink-0" />
                  {!collapsed && (
                    <span className="text-sm font-medium ml-2">
                      {i18n.language === 'zh' ? '中文' : 'English'}
                    </span>
                  )}
                </Button>
                <Dropdown.Popover>
                  <Dropdown.Menu
                    selectedKeys={[i18n.language]}
                    selectionMode="single"
                    onAction={(key) => switchLang(key as 'en' | 'zh')}
                  >
                    <Dropdown.Item id="en" textValue="English">
                      <Label>English</Label>
                    </Dropdown.Item>
                    <Dropdown.Item id="zh" textValue="中文">
                      <Label>中文</Label>
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </motion.div>
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
          transition-transform duration-300 ease-in-out bg-white border-r border-neutral-200
          w-64 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex flex-col h-full p-4">
          <div className="flex items-center justify-between mb-6">
            <span className="text-2xl font-bold text-neutral-900 libre">{brand}</span>
            <Tooltip delay={0}>
              <Button
                isIconOnly
                aria-label="Close sidebar"
                size="sm"
                variant="ghost"
                onPress={onMobileClose}
              >
                <Xmark className="w-5 h-5" />
              </Button>
              <Tooltip.Content>
                <p>{t('nav.collapseSidebar')}</p>
              </Tooltip.Content>
            </Tooltip>
          </div>

          <nav className="flex-1 flex flex-col gap-1">
            {items.map((item) => {
              const isActive = location.pathname === item.to;
              const label = t(item.label);
              return (
                <div key={item.to} className="flex items-center">
                  <Button
                    size="lg"
                    variant={isActive ? 'primary' : 'ghost'}
                    className={`flex-1 justify-start px-3 mr-1 ${isActive ? 'rounded-[15px]' : ''}`}
                    onPress={() => { navigate(item.to); onMobileClose(); }}
                  >
                    <item.icon className="w-5 h-5 shrink-0" />
                    <span className="font-medium ml-3">{label}</span>
                  </Button>
                  {isActive && (
                    <div className="h-6 w-2 bg-blue-500 shrink-0 rounded-md" />
                  )}
                </div>
              );
            })}
          </nav>

          <div className="pt-4 border-t border-neutral-200 space-y-2">
            <p className="text-xs text-neutral-500 px-3 truncate">
              {t('nav.pages', { count: items.length })}
            </p>
            {bottomItems?.map((item) => {
              const label = t(item.label);
              const isActive = location.pathname === item.to;
              return (
                <div key={item.to} className="flex items-center">
                  <Button
                    size="lg"
                    variant={isActive ? 'primary' : 'ghost'}
                    className={`flex-1 justify-start px-3 mr-1 ${isActive ? 'rounded-[15px]' : ''}`}
                    onPress={() => { navigate(item.to); onMobileClose(); }}
                  >
                    <item.icon className="w-5 h-5 shrink-0" />
                    <span className="font-medium ml-3">{label}</span>
                  </Button>
                  {isActive && (
                    <div className="h-6 w-2 bg-blue-500 shrink-0 rounded-md" />
                  )}
                </div>
              );
            })}
            <Dropdown>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('nav.toggleSidebar')}
                className="flex-1 justify-start px-3 w-full"
              >
                <Globe className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium ml-2">
                  {i18n.language === 'zh' ? '中文' : 'English'}
                </span>
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={[i18n.language]}
                  selectionMode="single"
                  onAction={(key) => switchLang(key as 'en' | 'zh')}
                >
                  <Dropdown.Item id="en" textValue="English">
                    <Label>English</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="zh" textValue="中文">
                    <Label>中文</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>
      </aside>
    </>
  );
}
