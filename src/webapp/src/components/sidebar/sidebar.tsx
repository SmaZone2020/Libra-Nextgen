'use client';

import type { ComponentPropsWithRef } from 'react';
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Button as AriaButton } from 'react-aria-components/Button';
import {
  Tree as TreePrimitive,
  TreeHeader as TreeHeaderPrimitive,
  TreeItem as TreeItemPrimitive,
  TreeItemContent as TreeItemContentPrimitive,
  TreeSection as TreeSectionPrimitive,
} from 'react-aria-components/Tree';
import { Button, ScrollShadow, Separator, Tooltip } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { setCookie } from '../../utils/cookie-storage';
import {
  matchesShortcut,
  parseToggleShortcut,
} from '../../utils/keyboard-shortcut';
import { TreeMotionProvider } from '../../utils/tree-motion';
import { ChevronRight, LayoutSideContentLeft } from '../icons';
import { Sheet } from '../sheet/index';
import type { SidebarVariants } from './sidebar.styles';
import { sidebarVariants } from './sidebar.styles';

type SidebarNavigate = (href: string) => void;

type SidebarContextValue = {
  collapsible: 'icon' | 'none' | 'offcanvas';
  isMobile: boolean;
  isMobileOpen: boolean;
  isOpen: boolean;
  navigate?: SidebarNavigate;
  reduceMotion: boolean;
  setMobileOpen: (open: boolean) => void;
  setOpen: (open: boolean) => void;
  side: 'left' | 'right';
  slots?: ReturnType<typeof sidebarVariants>;
  toggleSidebar: () => void;
  variant: 'floating' | 'inset' | 'sidebar';
};

const SidebarContext = createContext<SidebarContextValue>({
  collapsible: 'icon',
  isMobile: false,
  isMobileOpen: false,
  isOpen: true,
  reduceMotion: false,
  setMobileOpen: () => {},
  setOpen: () => {},
  side: 'left',
  toggleSidebar: () => {},
  variant: 'sidebar',
});

/** Hook for programmatic sidebar control. */
const useSidebar = () => useContext(SidebarContext);

// Context for closeMobileOnAction inheritance
const CloseMobileContext = createContext<boolean | undefined>(undefined);

interface SidebarProviderProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  collapsible?: 'icon' | 'none' | 'offcanvas';
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  navigate?: SidebarNavigate;
  open?: boolean;
  reduceMotion?: boolean;
  side?: SidebarVariants['side'];
  toggleShortcut?: string | false | null;
  variant?: SidebarVariants['variant'];
}

const SidebarProvider = ({
  children,
  className,
  collapsible = 'icon',
  defaultOpen = true,
  navigate,
  onOpenChange,
  open: openProp,
  reduceMotion = false,
  side = 'left',
  toggleShortcut = 'mod+b',
  variant = 'sidebar',
  ...props
}: SidebarProviderProps) => {
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = openProp ?? internalOpen;

  const setOpen = useCallback(
    (val: boolean) => {
      onOpenChange?.(val);
      if (!isControlled) {
        setInternalOpen(val);
        setCookie('sidebar_state', String(val));
      }
    },
    [onOpenChange, isControlled]
  );

  const [isMobile, setIsMobile] = useState(false);
  const [isMobileOpen, setMobileOpen] = useState(false);

  const slots = useMemo(
    () => sidebarVariants({ side, variant }),
    [side, variant]
  );

  const toggleSidebar = useCallback(() => {
    if (collapsible === 'none') return;
    if (isMobile) {
      setMobileOpen((v) => !v);
    } else {
      setOpen(!isOpen);
    }
  }, [collapsible, isMobile, isOpen, setOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
      if (e.matches) setMobileOpen(false);
    };
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!toggleShortcut) return;
    const parsed = parseToggleShortcut(toggleShortcut as string);
    if (!parsed) return;
    const handler = (e: KeyboardEvent) => {
      if (matchesShortcut(e, parsed)) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleShortcut, toggleSidebar]);

  const ctxValue = useMemo(
    () => ({
      collapsible: collapsible ?? 'icon',
      isMobile,
      isMobileOpen,
      isOpen,
      navigate,
      reduceMotion,
      setMobileOpen,
      setOpen,
      side: side ?? 'left',
      slots,
      toggleSidebar,
      variant: variant ?? 'sidebar',
    }),
    [
      collapsible,
      isMobile,
      isMobileOpen,
      isOpen,
      navigate,
      reduceMotion,
      setMobileOpen,
      setOpen,
      side,
      slots,
      toggleSidebar,
      variant,
    ]
  );

  return (
    <SidebarContext.Provider value={ctxValue}>
      <div
        className={composeSlotClassName(slots?.provider, className)}
        data-sidebar="provider"
        data-slot="sidebar-provider"
        data-state={isOpen ? 'expanded' : 'collapsed'}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
};

interface SidebarRootProps extends ComponentPropsWithRef<'aside'> {
  children: ReactNode;
}

const SidebarRoot = ({ children, className, ...props }: SidebarRootProps) => {
  const { collapsible, isOpen, side, slots, variant } = useSidebar();
  const state = isOpen ? 'expanded' : 'collapsed';
  const aside = (
    <aside
      className={composeSlotClassName(slots?.base, className)}
      data-collapsible={collapsible}
      data-side={side}
      data-slot="sidebar"
      data-state={state}
      data-variant={variant}
      {...props}
    >
      {children}
    </aside>
  );
  if (collapsible === 'offcanvas') {
    return (
      <div
        className="sidebar__offcanvas-wrapper"
        data-side={side}
        data-state={state}
      >
        {aside}
      </div>
    );
  }
  return aside;
};

interface SidebarHeaderProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const SidebarHeader = ({
  children,
  className,
  ...props
}: SidebarHeaderProps) => {
  const { slots } = useSidebar();
  return (
    <div
      className={composeSlotClassName(slots?.header, className)}
      data-slot="sidebar-header"
      {...props}
    >
      {children}
    </div>
  );
};

interface SidebarContentProps extends ComponentPropsWithRef<
  typeof ScrollShadow
> {
  children: ReactNode;
}

const SidebarContent = ({
  children,
  className,
  ...props
}: SidebarContentProps) => {
  const { slots } = useSidebar();
  return (
    <ScrollShadow
      hideScrollBar
      className={composeSlotClassName(slots?.content, className)}
      data-slot="sidebar-content"
      {...props}
    >
      {children}
    </ScrollShadow>
  );
};

interface SidebarFooterProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const SidebarFooter = ({
  children,
  className,
  ...props
}: SidebarFooterProps) => {
  const { slots } = useSidebar();
  return (
    <div
      className={composeSlotClassName(slots?.footer, className)}
      data-slot="sidebar-footer"
      {...props}
    >
      {children}
    </div>
  );
};

interface SidebarGroupProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  closeMobileOnAction?: boolean;
}

const SidebarGroup = ({
  children,
  className,
  closeMobileOnAction,
  ...props
}: SidebarGroupProps) => {
  const { slots } = useSidebar();
  const div = (
    <div
      className={composeSlotClassName(slots?.group, className)}
      data-slot="sidebar-group"
      {...props}
    >
      {children}
    </div>
  );
  return closeMobileOnAction !== undefined ? (
    <CloseMobileContext.Provider value={closeMobileOnAction}>
      {div}
    </CloseMobileContext.Provider>
  ) : (
    div
  );
};

interface SidebarGroupLabelProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const SidebarGroupLabel = ({
  children,
  className,
  ...props
}: SidebarGroupLabelProps) => {
  const { slots } = useSidebar();
  return (
    <div
      className={composeSlotClassName(slots?.groupLabel, className)}
      data-slot="sidebar-group-label"
      {...props}
    >
      {children}
    </div>
  );
};

type SidebarMenuDisallowedProps =
  | 'defaultSelectedKeys'
  | 'disallowEmptySelection'
  | 'escapeKeyBehavior'
  | 'onSelectionChange'
  | 'selectedKeys'
  | 'selectionBehavior'
  | 'selectionMode'
  | 'shouldSelectOnPressUp';

interface SidebarMenuProps<T extends object> extends Omit<
  ComponentPropsWithRef<typeof TreePrimitive<T>>,
  SidebarMenuDisallowedProps
> {
  defaultSelectedKeys?: never;
  disallowEmptySelection?: never;
  escapeKeyBehavior?: never;
  onSelectionChange?: never;
  reduceMotion?: boolean;
  selectedKeys?: never;
  selectionBehavior?: never;
  selectionMode?: never;
  closeMobileOnAction?: boolean;
  showGuideLines?: boolean | 'hover';
  shouldSelectOnPressUp?: never;
}

const guideLineDataMap: Record<string, string> = {
  false: 'none',
  hover: 'hover',
  true: 'always',
};

const SidebarMenu = <T extends object>({
  children,
  className,
  closeMobileOnAction,
  reduceMotion,
  showGuideLines = true,
  ...props
}: SidebarMenuProps<T>) => {
  const { reduceMotion: ctxReduceMotion, slots } = useSidebar();
  const parentCloseMobile = useContext(CloseMobileContext);
  const resolvedClose = closeMobileOnAction ?? parentCloseMobile;
  const guideLines = guideLineDataMap[String(showGuideLines)];

  const tree = (
    <TreeMotionProvider reduceMotion={reduceMotion ?? ctxReduceMotion}>
      <TreePrimitive
        className={composeTwRenderProps(className, slots?.menu())}
        data-guide-lines={guideLines}
        data-sidebar="menu"
        data-slot="sidebar-menu"
        {...props}
      >
        {children}
      </TreePrimitive>
    </TreeMotionProvider>
  );

  return resolvedClose !== undefined ? (
    <CloseMobileContext.Provider value={resolvedClose}>
      {tree}
    </CloseMobileContext.Provider>
  ) : (
    tree
  );
};

interface SidebarMenuSectionProps extends ComponentPropsWithRef<
  typeof TreeSectionPrimitive
> {}

const SidebarMenuSection = ({
  children,
  className,
  ...props
}: SidebarMenuSectionProps) => {
  const { slots } = useSidebar();
  return (
    <TreeSectionPrimitive
      className={composeSlotClassName(slots?.menuSection, className)}
      data-slot="sidebar-menu-section"
      {...props}
    >
      {children}
    </TreeSectionPrimitive>
  );
};

interface SidebarMenuHeaderProps extends ComponentPropsWithRef<
  typeof TreeHeaderPrimitive
> {}

const SidebarMenuHeader = ({
  children,
  className,
  ...props
}: SidebarMenuHeaderProps) => {
  const { slots } = useSidebar();
  return (
    <TreeHeaderPrimitive
      className={composeSlotClassName(slots?.menuHeader, className)}
      data-slot="sidebar-menu-header"
      {...props}
    >
      {children}
    </TreeHeaderPrimitive>
  );
};

interface SidebarMenuIconProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const SidebarMenuIcon = ({
  children,
  className,
  ...props
}: SidebarMenuIconProps) => {
  const { slots } = useSidebar();
  return (
    <span
      className={composeSlotClassName(slots?.menuIcon, className)}
      data-slot="sidebar-menu-icon"
      {...props}
    >
      {children}
    </span>
  );
};

interface SidebarMenuLabelProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const SidebarMenuLabel = ({
  children,
  className,
  ...props
}: SidebarMenuLabelProps) => {
  const { slots } = useSidebar();
  const regularChildren: React.ReactNode[] = [];
  const chipChildren: React.ReactNode[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === SidebarMenuTrigger) {
      chipChildren.push(child);
    } else {
      regularChildren.push(child);
    }
  });
  return (
    <span
      className={composeSlotClassName(slots?.menuLabel, className)}
      data-sidebar="label"
      data-slot="sidebar-menu-label"
      {...props}
    >
      <span
        className={slots?.menuLabelText()}
        data-slot="sidebar-menu-label-text"
      >
        {regularChildren}
      </span>
      {chipChildren}
    </span>
  );
};

interface SidebarMenuChipProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

const SidebarMenuChip = ({
  children,
  className,
  ...props
}: SidebarMenuChipProps) => {
  const { slots } = useSidebar();
  return (
    <span
      className={composeSlotClassName(slots?.menuChip, className)}
      data-slot="sidebar-menu-chip"
      {...props}
    >
      {children}
    </span>
  );
};

interface SidebarMenuActionsProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const SidebarMenuActions = ({
  children,
  className,
  ...props
}: SidebarMenuActionsProps) => {
  const { slots } = useSidebar();
  return (
    <div
      className={composeSlotClassName(slots?.menuActions, className)}
      data-slot="sidebar-menu-actions"
      {...props}
    >
      {children}
    </div>
  );
};

interface SidebarMenuActionProps extends ComponentPropsWithRef<
  typeof AriaButton
> {
  children: ReactNode;
}

const SidebarMenuAction = ({
  children,
  className,
  ...props
}: SidebarMenuActionProps) => {
  const { slots } = useSidebar();
  return (
    <AriaButton
      className={composeTwRenderProps(className, slots?.menuAction())}
      data-slot="sidebar-menu-action"
      {...props}
    >
      {children}
    </AriaButton>
  );
};

interface SidebarMenuItemContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const SidebarMenuItemContent = ({ children }: SidebarMenuItemContentProps) => (
  <>{children}</>
);

interface SidebarMenuTriggerProps extends ComponentPropsWithRef<
  typeof AriaButton
> {
  children: ReactNode;
}

const SidebarMenuTrigger = ({ children }: SidebarMenuTriggerProps) => (
  <>{children}</>
);

interface SidebarMenuIndicatorProps extends ComponentPropsWithRef<
  typeof ChevronRight
> {
  children?: ReactNode;
}

const SidebarMenuIndicator = ({
  children,
  className,
  ...props
}: SidebarMenuIndicatorProps) => {
  const { slots } = useSidebar();
  if (children && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<{
        className?: string;
        'data-slot'?: string;
      }>,
      {
        ...props,
        className: composeSlotClassName(slots?.menuIndicator, className),
        'data-slot': 'sidebar-menu-indicator',
      }
    );
  }
  return (
    <ChevronRight
      className={composeSlotClassName(slots?.menuIndicator, className)}
      data-slot="sidebar-menu-indicator"
      {...props}
    />
  );
};

interface SidebarSubmenuProps {
  children: ReactNode;
}

const SidebarSubmenu = ({ children }: SidebarSubmenuProps) => <>{children}</>;

// Helper: extract text from react children
function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node))
    return extractText((node.props as { children?: ReactNode }).children);
  return '';
}

// Helper: collect item slot children
function collectSlotChildren(
  children: ReactNode,
  regular: React.ReactNode[],
  submenuChildren: React.ReactNode[],
  contentPropsRef?: {
    value?: {
      children?: ReactNode;
      className?: string;
      [key: string]: unknown;
    };
  }
) {
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (child.type !== React.Fragment) {
        if (child.type !== SidebarSubmenu) {
          if (child.type === SidebarMenuItemContent) {
            if (contentPropsRef)
              contentPropsRef.value =
                child.props as typeof contentPropsRef.value;
            return;
          }
          regular.push(child);
        } else {
          submenuChildren.push(
            ...React.Children.toArray(
              (child.props as { children?: ReactNode }).children
            )
          );
        }
      } else {
        collectSlotChildren(
          (child.props as { children?: ReactNode }).children,
          regular,
          submenuChildren,
          contentPropsRef
        );
      }
    } else {
      regular.push(child);
    }
  });
}

interface SidebarMenuItemTooltipProps {
  content: ReactNode;
  className?: string;
  delay?: number;
  closeDelay?: number;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

interface SidebarMenuItemProps extends Partial<
  ComponentPropsWithRef<typeof TreeItemPrimitive>
> {
  closeMobileOnAction?: boolean;
  forceReload?: boolean;
  href?: string;
  isCurrent?: boolean;
  tooltip?: ReactNode;
  tooltipProps?: SidebarMenuItemTooltipProps;
}

const SidebarMenuItem = ({
  children,
  className,
  closeMobileOnAction,
  forceReload = false,
  href,
  isCurrent = false,
  render: renderProp,
  textValue,
  tooltip,
  tooltipProps,
  ...props
}: SidebarMenuItemProps) => {
  const {
    collapsible,
    isMobile,
    isOpen: sidebarIsOpen,
    navigate,
    setMobileOpen,
    slots,
  } = useSidebar();
  const parentCloseMobile = useContext(CloseMobileContext);
  const resolvedClose = closeMobileOnAction ?? parentCloseMobile ?? true;

  const isIconOnly = collapsible === 'icon' && !isMobile && !sidebarIsOpen;

  const regularChildren: React.ReactNode[] = [];
  const submenuChildren: React.ReactNode[] = [];
  const contentPropsRef: {
    value?: {
      children?: ReactNode;
      className?: string;
      [key: string]: unknown;
    };
  } = {};
  collectSlotChildren(
    children,
    regularChildren,
    submenuChildren,
    contentPropsRef
  );

  const textValueResolved = textValue ?? extractText(regularChildren);
  const tooltipContent = tooltip ?? textValueResolved;
  const submenuEl = submenuChildren.length > 0 ? submenuChildren : null;

  const {
    children: contentChildren,
    className: contentClassName,
    ...contentRestProps
  } = contentPropsRef.value ?? {};

  const enhancedChildren = regularChildren.map((child, i) => {
    if (React.isValidElement(child)) {
      const childEl = child as React.ReactElement;
      if (childEl.type === SidebarMenuTrigger) {
        const {
          children: triggerChildren,
          className: triggerClassName,
          ...triggerRest
        } = childEl.props as {
          children?: ReactNode;
          className?: string;
          [key: string]: unknown;
        };
        return (
          <AriaButton
            key={childEl.key ?? i}
            className={composeTwRenderProps(
              triggerClassName as string | undefined,
              slots?.menuTrigger()
            )}
            data-slot="sidebar-menu-trigger"
            slot="chevron"
            {...triggerRest}
          >
            {triggerChildren}
          </AriaButton>
        );
      }
      if (
        isIconOnly &&
        !tooltipProps &&
        tooltipContent &&
        childEl.type === SidebarMenuIcon
      ) {
        return (
          <SidebarTooltip key={childEl.key ?? i} content={tooltipContent}>
            {childEl}
          </SidebarTooltip>
        );
      }
    }
    return child;
  });

  const shouldCloseOnAction =
    resolvedClose && isMobile && submenuChildren.length === 0;
  const handleAction = useCallback(() => {
    if (href) {
      if (shouldCloseOnAction) setMobileOpen(false);
      if (/^https?:\/\//.test(href)) {
        window.open(href, '_blank', 'noopener,noreferrer');
      } else if (navigate && !forceReload) {
        navigate(href);
      } else {
        window.location.href = href;
      }
    }
  }, [href, shouldCloseOnAction, setMobileOpen, navigate, forceReload]);

  const itemContent = (
    <div
      className={composeSlotClassName(
        slots?.menuItemContent,
        contentClassName as string | undefined
      )}
      data-slot="sidebar-menu-item-content"
      {...contentRestProps}
    >
      {enhancedChildren}
    </div>
  );

  return (
    <TreeItemPrimitive
      aria-current={isCurrent ? 'page' : undefined}
      className={composeTwRenderProps(className, slots?.menuItem())}
      data-current={isCurrent ? 'true' : undefined}
      data-slot="sidebar-menu-item"
      render={renderProp}
      textValue={textValueResolved}
      {...props}
      {...(href ? { onAction: handleAction } : {})}
    >
      <TreeItemContentPrimitive>
        {tooltipProps ? (
          <Tooltip
            closeDelay={tooltipProps.closeDelay}
            delay={tooltipProps.delay}
          >
            <Tooltip.Trigger className="w-full">{itemContent}</Tooltip.Trigger>
            <Tooltip.Content
              className={tooltipProps.className}
              placement={tooltipProps.placement ?? 'right'}
            >
              {tooltipProps.content}
            </Tooltip.Content>
          </Tooltip>
        ) : (
          itemContent
        )}
      </TreeItemContentPrimitive>
      {submenuEl}
    </TreeItemPrimitive>
  );
};

interface SidebarSeparatorProps extends ComponentPropsWithRef<
  typeof Separator
> {}

const SidebarSeparator = ({ className, ...props }: SidebarSeparatorProps) => {
  const { slots } = useSidebar();
  return (
    <Separator
      className={composeSlotClassName(slots?.separator, className)}
      data-slot="sidebar-separator"
      {...props}
    />
  );
};

interface SidebarTriggerProps extends ComponentPropsWithRef<typeof Button> {
  children?: ReactNode;
}

const SidebarTrigger = ({
  children,
  className,
  ...props
}: SidebarTriggerProps) => {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      isIconOnly
      className={className}
      data-slot="sidebar-trigger"
      size="sm"
      variant="ghost"
      onPress={toggleSidebar}
      {...props}
    >
      {children ?? <LayoutSideContentLeft className="size-4" />}
    </Button>
  );
};

interface SidebarRailProps extends ComponentPropsWithRef<'button'> {}

const SidebarRail = ({ className, ...props }: SidebarRailProps) => {
  const { slots, toggleSidebar } = useSidebar();
  return (
    <button
      aria-label="Toggle sidebar"
      className={composeSlotClassName(slots?.rail, className)}
      data-slot="sidebar-rail"
      tabIndex={-1}
      type="button"
      onClick={toggleSidebar}
      {...props}
    />
  );
};

interface SidebarMainProps extends ComponentPropsWithRef<'main'> {
  children: ReactNode;
}

const SidebarMain = ({ children, className, ...props }: SidebarMainProps) => {
  const { slots } = useSidebar();
  return (
    <main
      className={composeSlotClassName(slots?.main, className)}
      data-slot="sidebar-main"
      {...props}
    >
      {children}
    </main>
  );
};

interface SidebarMobileProps extends ComponentPropsWithRef<'div'> {
  backdrop?: 'blur' | 'opaque' | 'transparent';
  children: ReactNode;
}

const SidebarMobile = ({
  backdrop = 'blur',
  children,
  className,
  ...props
}: SidebarMobileProps) => {
  const { isMobile, isMobileOpen, setMobileOpen, side, slots } = useSidebar();
  if (!isMobile) return null;
  return (
    <Sheet
      isOpen={isMobileOpen}
      placement={side as 'left' | 'right'}
      onOpenChange={setMobileOpen}
    >
      <Sheet.Backdrop variant={backdrop}>
        <Sheet.Content className="sidebar__mobile-sheet">
          <Sheet.Dialog className="sidebar__mobile-dialog">
            <div
              className={composeSlotClassName(slots?.mobile, className)}
              data-slot="sidebar-mobile"
              {...props}
            >
              {children}
            </div>
          </Sheet.Dialog>
        </Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
  );
};

interface SidebarTooltipProps extends Omit<
  ComponentPropsWithRef<typeof Tooltip.Content>,
  'children'
> {
  children: ReactNode;
  content: ReactNode;
  delay?: number;
  closeDelay?: number;
}

const SidebarTooltip = ({
  children,
  closeDelay,
  content,
  delay,
  placement = 'right',
  ...props
}: SidebarTooltipProps) => {
  const { isOpen } = useSidebar();
  if (isOpen) return <>{children}</>;
  return (
    <Tooltip closeDelay={closeDelay} delay={delay}>
      <Tooltip.Trigger>{children}</Tooltip.Trigger>
      <Tooltip.Content placement={placement} {...props}>
        {content}
      </Tooltip.Content>
    </Tooltip>
  );
};

export {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMain,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuActions,
  SidebarMenuChip,
  SidebarMenuHeader,
  SidebarMenuIcon,
  SidebarMenuIndicator,
  SidebarMenuItem,
  SidebarMenuItemContent,
  SidebarMenuLabel,
  SidebarMenuSection,
  SidebarMenuTrigger,
  SidebarMobile,
  SidebarProvider,
  SidebarRail,
  SidebarRoot,
  SidebarSeparator,
  SidebarSubmenu,
  SidebarTooltip,
  SidebarTrigger,
  useSidebar,
};

export type {
  SidebarContentProps,
  SidebarFooterProps,
  SidebarGroupLabelProps,
  SidebarGroupProps,
  SidebarHeaderProps,
  SidebarMainProps,
  SidebarMenuActionProps,
  SidebarMenuActionsProps,
  SidebarMenuChipProps,
  SidebarMenuHeaderProps,
  SidebarMenuIconProps,
  SidebarMenuIndicatorProps,
  SidebarMenuItemContentProps,
  SidebarMenuItemProps,
  SidebarMenuItemTooltipProps,
  SidebarMenuLabelProps,
  SidebarMenuProps,
  SidebarMenuSectionProps,
  SidebarMenuTriggerProps,
  SidebarMobileProps,
  SidebarNavigate,
  SidebarProviderProps,
  SidebarRailProps,
  SidebarRootProps,
  SidebarSeparatorProps,
  SidebarSubmenuProps,
  SidebarTooltipProps,
  SidebarTriggerProps,
};
