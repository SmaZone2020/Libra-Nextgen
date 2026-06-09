'use client';

import React, {
  type ComponentProps,
  type ComponentPropsWithRef,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { Button, Tooltip } from '@heroui/react';
import { composeTwRenderProps } from '../../utils/compose';
import { setCookie } from '../../utils/cookie-storage';
import {
  matchesShortcut,
  parseToggleShortcut,
} from '../../utils/keyboard-shortcut';
import { Bars, LayoutSideContentRight } from '../icons';
import { Resizable } from '../resizable/index';
import { Sheet } from '../sheet/index';
import { SidebarProvider, useSidebar } from '../sidebar/sidebar';
import type { SidebarVariants } from '../sidebar/sidebar.styles';
import { appLayoutVariants } from './app-layout.styles';
import '../sidebar/index';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AppLayoutContextValue = {
  isAsideOpen: boolean;
  /** Whether a user-provided <AppLayout.MobileAside> slot was rendered. */
  hasMobileAside: boolean;
  /** Programmatic navigation function forwarded from `AppLayout.navigate`. */
  navigate?: (href: string) => void;
  setAsideOpen: (open: boolean) => void;
  slots: ReturnType<typeof appLayoutVariants>;
  toggleAside: () => void;
};

export interface AppLayoutTooltipProps {
  /** Class name applied to the Tooltip.Content element. */
  className?: string;
  /** Delay in ms before hiding the tooltip. */
  closeDelay?: number;
  /** Delay in ms before showing the tooltip. */
  delay?: number;
  /** Whether the tooltip is disabled. */
  isDisabled?: boolean;
  /** Offset from the trigger element in px. */
  offset?: number;
  /** Tooltip placement relative to the trigger. @default "bottom" */
  placement?: ComponentProps<typeof Tooltip.Content>['placement'];
  /** Whether to show the tooltip arrow. @default false */
  showArrow?: boolean;
}

export interface AppLayoutMenuToggleProps extends ComponentPropsWithRef<
  typeof Button
> {
  /** Custom icon. Defaults to a hamburger (Bars) icon. */
  children?: ReactNode;
  /** Tooltip content. When omitted, no tooltip is rendered. */
  tooltip?: ReactNode;
  /** Additional props forwarded to the internal Tooltip. */
  tooltipProps?: AppLayoutTooltipProps;
}

export interface AppLayoutAsideTriggerProps extends ComponentPropsWithRef<
  typeof Button
> {
  /** Custom icon. Defaults to a right-panel icon. */
  children?: ReactNode;
  /** Tooltip content when the aside is closed. */
  closedTooltip?: ReactNode;
  /** Tooltip content when the aside is open. */
  openTooltip?: ReactNode;
  /** Additional props forwarded to the internal Tooltip. */
  tooltipProps?: AppLayoutTooltipProps;
}

export interface AppLayoutMobileAsideProps {
  children: ReactNode;
}

export type SidebarNavigate = (href: string) => void;
export type AppLayoutScrollMode = 'content' | 'page';

export interface AppLayoutRootProps extends Omit<
  ComponentPropsWithRef<'div'>,
  'children'
> {
  aside?: ReactNode;
  asideMobile?: 'hidden' | 'sheet';
  asideDefaultSize?: number;
  asideMaxSize?: number;
  asideMinSize?: number;
  asideOpen?: boolean;
  asideResizable?: boolean;
  asideToggleShortcut?: string | false | null;
  children: ReactNode;
  defaultAsideOpen?: boolean;
  defaultSidebarOpen?: boolean;
  footer?: ReactNode;
  navbar?: ReactNode;
  navigate?: SidebarNavigate;
  onAsideOpenChange?: (open: boolean) => void;
  onSidebarOpenChange?: (open: boolean) => void;
  reduceMotion?: boolean;
  resizableAutoSaveId?: string;
  scrollMode?: AppLayoutScrollMode;
  sidebar?: ReactNode;
  sidebarCollapsible?: 'icon' | 'none' | 'offcanvas';
  sidebarDefaultSize?: number;
  sidebarMaxSize?: number;
  sidebarMinSize?: number;
  sidebarOpen?: boolean;
  sidebarResizable?: boolean;
  sidebarSide?: SidebarVariants['side'];
  sidebarVariant?: SidebarVariants['variant'];
  toggleShortcut?: string | false | null;
  toolbar?: ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

interface ResizableLayoutProps {
  aside?: ReactNode;
  asideDefaultSize: number;
  asideMaxSize: number;
  asideMinSize: number;
  asideResizable: boolean;
  bodySection: ReactNode;
  isAsideOpen: boolean;
  isSidebarOpen: boolean;
  resizableAutoSaveId?: string;
  setAsideOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  sidebar?: ReactNode;
  sidebarDefaultSize: number;
  sidebarMaxSize: number;
  sidebarMinSize: number;
  sidebarResizable: boolean;
  sidebarSide: string;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const AppLayoutContext = createContext<AppLayoutContextValue | null>(
  null
);
export const useAppLayout = () => useContext(AppLayoutContext);

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(query);
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

function withTooltip(
  trigger: ReactNode,
  content: ReactNode | undefined,
  tooltipProps: AppLayoutTooltipProps | undefined
): ReactNode {
  if (!content) return trigger;
  return (
    <Tooltip
      closeDelay={tooltipProps?.closeDelay}
      delay={tooltipProps?.delay}
      isDisabled={tooltipProps?.isDisabled}
    >
      <Tooltip.Trigger>{trigger}</Tooltip.Trigger>
      <Tooltip.Content
        className={tooltipProps?.className}
        offset={tooltipProps?.offset}
        placement={tooltipProps?.placement ?? 'bottom'}
        showArrow={tooltipProps?.showArrow}
      >
        {tooltipProps?.showArrow ? <Tooltip.Arrow /> : null}
        {content}
      </Tooltip.Content>
    </Tooltip>
  );
}

// ─── Components ───────────────────────────────────────────────────────────────

export const AppLayoutMenuToggle = ({
  children,
  className,
  tooltip,
  tooltipProps,
  ...props
}: AppLayoutMenuToggleProps): ReactNode => {
  const { setMobileOpen } = useSidebar();
  const ctx = useContext(AppLayoutContext);

  const trigger = (
    <Button
      isIconOnly
      aria-label="Open navigation"
      className={composeTwRenderProps(className, ctx?.slots?.menuToggle())}
      data-slot="app-layout-menu-toggle"
      size="sm"
      variant="ghost"
      onPress={() => setMobileOpen(true)}
      {...props}
    >
      {children ?? <Bars className="size-4" />}
    </Button>
  );

  return withTooltip(trigger, tooltip, tooltipProps);
};

export const AppLayoutAsideTrigger = ({
  children,
  className,
  closedTooltip,
  openTooltip,
  tooltipProps,
  ...props
}: AppLayoutAsideTriggerProps): ReactNode => {
  const ctx = useContext(AppLayoutContext);
  const isOpen = ctx?.isAsideOpen ?? false;

  const trigger = (
    <Button
      isIconOnly
      aria-expanded={isOpen}
      aria-label="Toggle aside panel"
      className={composeTwRenderProps(className, ctx?.slots?.asideTrigger())}
      data-slot="app-layout-aside-trigger"
      data-state={isOpen ? 'open' : 'closed'}
      size="sm"
      variant="ghost"
      onPress={() => ctx?.toggleAside()}
      {...props}
    >
      {children ?? <LayoutSideContentRight className="size-4" />}
    </Button>
  );

  return withTooltip(
    trigger,
    isOpen ? openTooltip : closedTooltip,
    tooltipProps
  );
};

export const AppLayoutMobileAside = ({
  children: _children,
}: AppLayoutMobileAsideProps): null => null;

export const AppLayoutRoot = ({
  aside,
  asideDefaultSize = 20,
  asideMaxSize = 40,
  asideMinSize = 15,
  asideMobile = 'hidden',
  asideOpen: asideOpenProp,
  asideResizable = false,
  asideToggleShortcut = null,
  children,
  className,
  defaultAsideOpen = true,
  defaultSidebarOpen = true,
  footer,
  navbar,
  navigate,
  onAsideOpenChange,
  onSidebarOpenChange,
  reduceMotion = false,
  resizableAutoSaveId,
  scrollMode = 'page',
  sidebar,
  sidebarCollapsible = 'icon',
  sidebarDefaultSize = 18,
  sidebarMaxSize = 30,
  sidebarMinSize = 12,
  sidebarOpen: sidebarOpenProp,
  sidebarResizable = false,
  sidebarSide = 'left',
  sidebarVariant = 'sidebar',
  style,
  toggleShortcut,
  toolbar,
  ...props
}: AppLayoutRootProps) => {
  const slots = useMemo(() => appLayoutVariants(), []);
  const isContentScroll = scrollMode === 'content';

  // Sidebar open state
  const isSidebarControlled = sidebarOpenProp !== undefined;
  const [sidebarOpenState, setSidebarOpenState] = useState(defaultSidebarOpen);
  const sidebarOpen = sidebarOpenProp ?? sidebarOpenState;

  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      onSidebarOpenChange?.(open);
      if (!isSidebarControlled) setSidebarOpenState(open);
    },
    [onSidebarOpenChange, isSidebarControlled]
  );

  // Aside open state
  const isAsideControlled = asideOpenProp !== undefined;
  const [asideOpenState, setAsideOpenState] = useState(defaultAsideOpen);
  const isAsideOpen = asideOpenProp ?? asideOpenState;

  const handleAsideOpenChange = useCallback(
    (open: boolean) => {
      onAsideOpenChange?.(open);
      if (!isAsideControlled) {
        setAsideOpenState(open);
        setCookie('aside_state', String(open));
      }
    },
    [onAsideOpenChange, isAsideControlled]
  );

  const toggleAside = useCallback(() => {
    handleAsideOpenChange(!isAsideOpen);
  }, [isAsideOpen, handleAsideOpenChange]);

  // Keyboard shortcut for aside toggle
  useEffect(() => {
    if (!asideToggleShortcut || !aside) return;
    const shortcut = parseToggleShortcut(asideToggleShortcut);
    if (!shortcut) return;
    const handler = (e: KeyboardEvent) => {
      if (matchesShortcut(e, shortcut)) {
        e.preventDefault();
        toggleAside();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [asideToggleShortcut, aside, toggleAside]);

  const isMobile = useMediaQuery('(max-width: 768px)');
  const isTablet = useMediaQuery('(max-width: 1024px)');
  const isResizable = (sidebarResizable || asideResizable) && !isMobile;

  // Separate MobileAside content from regular children
  const { contentChildren, mobileAsideContent } = useMemo(() => {
    let mobileAsideNode: ReactNode = null;
    const rest: ReactNode[] = [];

    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && child.type === AppLayoutMobileAside) {
        mobileAsideNode = (child.props as AppLayoutMobileAsideProps).children;
      } else {
        rest.push(child);
      }
    });

    return { contentChildren: rest, mobileAsideContent: mobileAsideNode };
  }, [children]);

  const hasMobileAside = mobileAsideContent != null;

  if (
    process.env.NODE_ENV !== 'production' &&
    sidebarResizable &&
    sidebarCollapsible === 'icon'
  ) {
    console.warn(
      '[AppLayout] `sidebarResizable` is only supported with `sidebarCollapsible="offcanvas"` or `"none"`. Falling back to the non-resizable layout.'
    );
  }

  const isSidebarResizable =
    sidebarResizable && sidebarCollapsible !== 'icon' && !isMobile;
  const isAsideResizable = asideResizable && !isTablet;

  const contextValue = useMemo<AppLayoutContextValue>(
    () => ({
      hasMobileAside,
      isAsideOpen,
      navigate,
      setAsideOpen: handleAsideOpenChange,
      slots,
      toggleAside,
    }),
    [
      hasMobileAside,
      isAsideOpen,
      navigate,
      handleAsideOpenChange,
      slots,
      toggleAside,
    ]
  );

  // Sections
  const headerSection = navbar ? (
    <header className={slots.header()} data-slot="app-layout-header">
      {navbar}
    </header>
  ) : null;

  const toolbarSection = toolbar ? (
    <div className={slots.toolbar()} data-slot="app-layout-toolbar">
      {toolbar}
    </div>
  ) : null;

  const mainSection = (
    <main
      aria-label={isContentScroll ? 'Scrollable main content' : undefined}
      className={slots.main()}
      data-scroll-mode={scrollMode}
      data-slot="app-layout-main"
      tabIndex={isContentScroll ? 0 : undefined}
    >
      {contentChildren}
    </main>
  );

  const footerSection = footer ? (
    <div className={slots.footer()} data-slot="app-layout-footer">
      {footer}
    </div>
  ) : null;

  const bodySection = (
    <div className={slots.body()} data-slot="app-layout-body">
      {headerSection}
      {toolbarSection}
      {mainSection}
      {footerSection}
    </div>
  );

  const asideSection = aside ? (
    <aside
      className={slots.aside()}
      data-slot="app-layout-aside"
      data-state={isAsideOpen ? 'open' : 'closed'}
    >
      {aside}
    </aside>
  ) : null;

  const mobileAsideSheet =
    aside && asideMobile === 'sheet' && isTablet ? (
      <Sheet
        isOpen={isAsideOpen}
        placement="right"
        onOpenChange={handleAsideOpenChange}
      >
        <Sheet.Backdrop variant="blur">
          <Sheet.Content className="app-layout__mobile-aside-sheet">
            <Sheet.Dialog className="app-layout__mobile-aside-dialog">
              <div
                className="app-layout__mobile-aside"
                data-slot="app-layout-mobile-aside"
              >
                {mobileAsideContent ?? aside}
              </div>
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
    ) : null;

  return (
    <AppLayoutContext.Provider value={contextValue}>
      {isResizable ? (
        <SidebarProvider
          className={className}
          collapsible={sidebarCollapsible}
          data-app-layout=""
          data-resizable=""
          data-scroll-mode={scrollMode}
          defaultOpen={defaultSidebarOpen}
          navigate={navigate}
          open={sidebarOpen}
          reduceMotion={reduceMotion}
          side={sidebarSide}
          style={style}
          toggleShortcut={toggleShortcut}
          variant={sidebarVariant}
          onOpenChange={handleSidebarOpenChange}
          {...props}
        >
          <ResizableLayout
            aside={aside}
            asideDefaultSize={asideDefaultSize}
            asideMaxSize={asideMaxSize}
            asideMinSize={asideMinSize}
            asideResizable={isAsideResizable}
            bodySection={bodySection}
            isAsideOpen={isAsideOpen}
            isSidebarOpen={sidebarOpen}
            resizableAutoSaveId={resizableAutoSaveId}
            setAsideOpen={handleAsideOpenChange}
            setSidebarOpen={handleSidebarOpenChange}
            sidebar={sidebar}
            sidebarDefaultSize={sidebarDefaultSize}
            sidebarMaxSize={sidebarMaxSize}
            sidebarMinSize={sidebarMinSize}
            sidebarResizable={isSidebarResizable}
            sidebarSide={sidebarSide ?? 'left'}
          />
          {mobileAsideSheet}
        </SidebarProvider>
      ) : (
        <SidebarProvider
          className={className}
          collapsible={sidebarCollapsible}
          data-app-layout=""
          data-scroll-mode={scrollMode}
          defaultOpen={defaultSidebarOpen}
          navigate={navigate}
          open={sidebarOpen}
          reduceMotion={reduceMotion}
          side={sidebarSide}
          style={style}
          toggleShortcut={toggleShortcut}
          variant={sidebarVariant}
          onOpenChange={handleSidebarOpenChange}
          {...props}
        >
          {sidebar}
          {bodySection}
          {asideSection}
          {mobileAsideSheet}
        </SidebarProvider>
      )}
    </AppLayoutContext.Provider>
  );
};

// ─── Resizable Layout (internal) ─────────────────────────────────────────────

const ResizableLayout = ({
  aside,
  asideDefaultSize,
  asideMaxSize,
  asideMinSize,
  asideResizable,
  bodySection,
  isAsideOpen,
  isSidebarOpen,
  resizableAutoSaveId,
  setAsideOpen,
  setSidebarOpen,
  sidebar,
  sidebarDefaultSize,
  sidebarMaxSize,
  sidebarMinSize,
  sidebarResizable,
  sidebarSide,
}: ResizableLayoutProps) => {
  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const asideRef = useRef<PanelImperativeHandle | null>(null);

  useEffect(() => {
    if (!sidebarResizable) return;
    const panel = sidebarRef.current;
    if (!panel) return;
    if (isSidebarOpen && panel.isCollapsed()) panel.expand();
    else if (!isSidebarOpen && !panel.isCollapsed()) panel.collapse();
  }, [isSidebarOpen, sidebarResizable]);

  useEffect(() => {
    if (!asideResizable) return;
    const panel = asideRef.current;
    if (!panel) return;
    if (isAsideOpen && panel.isCollapsed()) panel.expand();
    else if (!isAsideOpen && !panel.isCollapsed()) panel.collapse();
  }, [isAsideOpen, asideResizable]);

  const sidebarPanel =
    sidebar && sidebarResizable ? (
      <Resizable.Panel
        key="sidebar-panel"
        collapsible
        className="app-layout__sidebar-panel"
        collapsedSize={0}
        defaultSize={sidebarDefaultSize}
        handleRef={sidebarRef}
        id="app-layout-sidebar"
        maxSize={sidebarMaxSize}
        minSize={sidebarMinSize}
        onCollapse={() => setSidebarOpen(false)}
        onExpand={() => setSidebarOpen(true)}
      >
        {sidebar}
      </Resizable.Panel>
    ) : null;

  const sidebarHandle =
    sidebar && sidebarResizable ? (
      <Resizable.Handle key="sidebar-handle" type="line" variant="primary" />
    ) : null;

  const asidePanel =
    aside && asideResizable ? (
      <Resizable.Panel
        key="aside-panel"
        collapsible
        className="app-layout__aside-panel"
        collapsedSize={0}
        defaultSize={asideDefaultSize}
        handleRef={asideRef}
        id="app-layout-aside"
        maxSize={asideMaxSize}
        minSize={asideMinSize}
        onCollapse={() => setAsideOpen(false)}
        onExpand={() => setAsideOpen(true)}
      >
        {aside}
      </Resizable.Panel>
    ) : null;

  const asideHandle =
    aside && asideResizable ? (
      <Resizable.Handle key="aside-handle" type="line" variant="primary" />
    ) : null;

  const staticSidebar = sidebar && !sidebarResizable ? sidebar : null;
  const staticAside =
    aside && !asideResizable ? (
      <aside
        className="app-layout__aside"
        data-slot="app-layout-aside"
        data-state={isAsideOpen ? 'open' : 'closed'}
      >
        {aside}
      </aside>
    ) : null;

  const mainPanel = (
    <Resizable.Panel
      key="main-panel"
      className="app-layout__main-panel"
      id="app-layout-main"
      minSize={30}
    >
      {bodySection}
    </Resizable.Panel>
  );

  return (
    <>
      {staticSidebar}
      <Resizable
        autoSaveId={resizableAutoSaveId}
        className="app-layout__resizable"
        orientation="horizontal"
      >
        {sidebarSide === 'left'
          ? [sidebarPanel, sidebarHandle, mainPanel, asideHandle, asidePanel]
          : [asidePanel, asideHandle, mainPanel, sidebarHandle, sidebarPanel]}
      </Resizable>
      {staticAside}
    </>
  );
};

export { AppLayoutAsideTrigger as default };
