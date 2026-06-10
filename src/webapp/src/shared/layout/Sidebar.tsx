import type { ComponentType, ReactNode, SVGProps } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bars, Xmark } from '@gravity-ui/icons';
import { Button, Tooltip } from '@heroui/react';
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
  onToggle: (v: boolean) => void;
}

export function Sidebar({
  brand = 'HeroUI',
  collapsed,
  items,
  onToggle,
}: SidebarProps) {
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
                <p>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</p>
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
                        {item.label}
                      </span>
                    </Button>
                    <Tooltip.Content showArrow placement="right">
                      {item.label}
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
            className="pt-4 border-t border-neutral-200 w-full"
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
                  {items.length} pages
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-neutral-200">
        <div className="flex items-center justify-around h-14 px-2">
          {items.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <button
                key={item.to}
                className={`flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 py-1 transition-colors ${
                  isActive ? 'text-blue-600' : 'text-neutral-500'
                }`}
                onClick={() => navigate(item.to)}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] leading-none truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
