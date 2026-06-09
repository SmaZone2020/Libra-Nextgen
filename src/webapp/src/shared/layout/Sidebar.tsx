import type { ComponentType, ReactNode, SVGProps } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bars, Xmark } from '@gravity-ui/icons';
import { Button } from '@heroui/react';

interface NavItem {
  icon: ComponentType<SVGProps<SVGSVGElement>> | (() => ReactNode);
  id: string;
  label: string;
}

interface SidebarProps {
  brand?: string;
  collapsed: boolean;
  currentPage: string;
  items: NavItem[];
  onNavigate: (id: string) => void;
  onToggle: (v: boolean) => void;
}

export function Sidebar({
  brand = 'HeroUI',
  collapsed,
  currentPage,
  items,
  onNavigate,
  onToggle,
}: SidebarProps) {
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
                  <span className="text-lg font-bold whitespace-nowrap block text-neutral-900">
                    {brand}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            <Button
              isIconOnly
              aria-label="Toggle sidebar"
              size="sm"
              variant="ghost"
              onPress={() => onToggle(!collapsed)}
            >
              {collapsed ? <Bars className="w-5 h-5" /> : <Xmark className="w-5 h-5" />}
            </Button>
          </div>

          <motion.nav
            layout
            className="flex-1 flex flex-col gap-1"
            transition={{ layout: { staggerChildren: 0.08 } }}
          >
            {items.map((item) => {
              const isActive = currentPage === item.id;
              return (
                <motion.div key={item.id} layout className="flex items-center">
                  <Button
                    isIconOnly={collapsed}
                    size="lg"
                    variant={isActive ? 'primary' : 'ghost'}
                    className={`flex-1 justify-start px-3 mr-1 transition-all duration-300 ${isActive ? 'rounded-[15px]' : ''}`}
                    onPress={() => onNavigate(item.id)}
                  >
                    <item.icon className="w-5 h-5 shrink-0" />
                    <span
                      className="overflow-hidden whitespace-nowrap transition-all duration-300"
                      style={{
                        maxWidth: collapsed ? 0 : '14rem',
                        opacity: collapsed ? 0 : 1,
                      }}
                    >
                      {item.label}
                    </span>
                  </Button>
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
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                className={`flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 py-1 transition-colors ${
                  isActive ? 'text-blue-600' : 'text-neutral-500'
                }`}
                onClick={() => onNavigate(item.id)}
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
