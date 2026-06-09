'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Menu, Popover, Separator } from 'react-aria-components/Menu';
import { PopoverContext } from 'react-aria-components/Popover';
import type { DOMRenderProps } from '@heroui/react';
import {
  dom,
  DropdownItem,
  DropdownItemIndicator,
  DropdownSection,
  DropdownSubmenuIndicator,
  DropdownSubmenuTrigger,
} from '@heroui/react';
import { useControlledState } from '@react-stately/utils';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { contextMenuVariants } from './context-menu.styles';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContextMenuRootProps {
  children: ReactNode;
  /** Default open state (uncontrolled). */
  defaultOpen?: boolean;
  /** Whether the context menu is disabled. */
  isDisabled?: boolean;
  /** Callback when open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state. */
  open?: boolean;
}

export interface ContextMenuTriggerProps<
  E extends keyof React.JSX.IntrinsicElements = 'div',
> extends DOMRenderProps<E, undefined> {
  children: ReactNode;
  className?: string;
}

export interface ContextMenuPopoverProps extends Omit<
  ComponentPropsWithRef<typeof Popover>,
  'children' | 'isOpen' | 'triggerRef'
> {
  children: ReactNode;
}

export interface ContextMenuMenuProps<
  T extends object,
> extends ComponentPropsWithRef<typeof Menu<T>> {}

export interface ContextMenuSeparatorProps extends ComponentPropsWithRef<
  typeof Separator
> {}

export type ContextMenuItemProps = ComponentPropsWithRef<typeof DropdownItem>;
export type ContextMenuItemIndicatorProps = ComponentPropsWithRef<
  typeof DropdownItemIndicator
>;
export type ContextMenuSectionProps = ComponentPropsWithRef<
  typeof DropdownSection
>;
export type ContextMenuSubmenuTriggerProps = ComponentPropsWithRef<
  typeof DropdownSubmenuTrigger
>;
export type ContextMenuSubmenuIndicatorProps = ComponentPropsWithRef<
  typeof DropdownSubmenuIndicator
>;

// ── Context ──────────────────────────────────────────────────────────────────

interface ContextMenuContextValue {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  handleClose: () => void;
  handleOpen: (x: number, y: number) => void;
  isOpen: boolean;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLDivElement | null>;
  slots?: ReturnType<typeof contextMenuVariants>;
}

const ContextMenuContext = createContext<ContextMenuContextValue>({
  anchorRef: { current: null },
  handleClose: () => {},
  handleOpen: () => {},
  isOpen: false,
  popoverRef: { current: null },
  triggerRef: { current: null },
});

// ── Components ───────────────────────────────────────────────────────────────

export const ContextMenuRoot = ({
  children,
  defaultOpen = false,
  isDisabled = false,
  onOpenChange,
  open,
}: ContextMenuRootProps) => {
  const [isOpen, setIsOpen] = useControlledState(
    open,
    defaultOpen,
    onOpenChange
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const slots = useMemo(() => contextMenuVariants(), []);

  const handleOpen = useCallback(
    (x: number, y: number) => {
      if (isDisabled) return;
      const anchor = anchorRef.current;
      const trigger = triggerRef.current;
      if (anchor && trigger) {
        const rect = trigger.getBoundingClientRect();
        anchor.style.left = x - rect.left + 'px';
        anchor.style.top = y - rect.top + 'px';
      }
      setIsOpen(true);
    },
    [isDisabled, setIsOpen]
  );

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  // Close on scroll outside the popover
  useEffect(() => {
    if (!isOpen) return;

    const onScroll = (e: Event) => {
      if (!popoverRef.current?.contains(e.target as Node)) setIsOpen(false);
    };

    window.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener('scroll', onScroll, { capture: true });
  }, [isOpen, setIsOpen]);

  // Handle contextmenu events to open at cursor position or close-and-reopen
  useEffect(() => {
    if (!isOpen) return;

    const onContextMenu = (e: MouseEvent) => {
      const popover = popoverRef.current;
      const trigger = triggerRef.current;

      if (popover?.contains(e.target as Node)) {
        e.preventDefault();
      } else {
        if (trigger) {
          const rect = trigger.getBoundingClientRect();
          if (
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom
          ) {
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(false);
            requestAnimationFrame(() => handleOpen(e.clientX, e.clientY));
            return;
          }
        }
        setIsOpen(false);
      }
    };

    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    return () =>
      window.removeEventListener('contextmenu', onContextMenu, {
        capture: true,
      });
  }, [isOpen, setIsOpen, handleOpen]);

  const contextValue = useMemo(
    () => ({
      anchorRef,
      handleClose,
      handleOpen,
      isOpen,
      popoverRef,
      slots,
      triggerRef,
    }),
    [handleClose, handleOpen, isOpen, slots]
  );

  return (
    <ContextMenuContext value={contextValue}>{children}</ContextMenuContext>
  );
};

export const ContextMenuTrigger = <
  E extends keyof React.JSX.IntrinsicElements = 'div',
>({
  children,
  className,
  ...props
}: ContextMenuTriggerProps<E> &
  Omit<React.JSX.IntrinsicElements[E], keyof ContextMenuTriggerProps<E>>) => {
  const { anchorRef, handleClose, handleOpen, isOpen, slots, triggerRef } =
    useContext(ContextMenuContext);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => clearTimeout(longPressTimeoutRef.current), []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) {
        handleClose();
        requestAnimationFrame(() => handleOpen(e.clientX, e.clientY));
      } else {
        handleOpen(e.clientX, e.clientY);
      }
    },
    [handleClose, handleOpen, isOpen]
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      longPressTimeoutRef.current = setTimeout(() => {
        if (touchStartPos.current)
          handleOpen(touchStartPos.current.x, touchStartPos.current.y);
      }, 500);
    },
    [handleOpen]
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartPos.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPos.current.x);
    const dy = Math.abs(touch.clientY - touchStartPos.current.y);
    if (dx > 10 || dy > 10) clearTimeout(longPressTimeoutRef.current);
  }, []);

  const onTouchEnd = useCallback(() => {
    clearTimeout(longPressTimeoutRef.current);
    touchStartPos.current = null;
  }, []);

  return (
    <dom.div
      ref={triggerRef as React.Ref<HTMLDivElement>}
      className={composeSlotClassName(slots?.trigger, className)}
      data-slot="context-menu-trigger"
      onContextMenu={onContextMenu}
      onTouchCancel={onTouchEnd}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
    >
      {children}
      <div
        ref={anchorRef}
        aria-hidden="true"
        style={{
          height: 0,
          pointerEvents: 'none',
          position: 'absolute',
          width: 0,
        }}
      />
    </dom.div>
  );
};

export const ContextMenuPopover = ({
  children,
  className,
  offset = 2,
  placement,
  ...props
}: ContextMenuPopoverProps) => {
  const { anchorRef, handleClose, isOpen, popoverRef, slots } =
    useContext(ContextMenuContext);
  const parentPopoverContext = useContext(PopoverContext);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) handleClose();
    },
    [handleClose]
  );

  if (parentPopoverContext != null) {
    return (
      <Popover
        className={composeTwRenderProps(className, slots?.popover())}
        data-slot="context-menu-popover"
        offset={offset}
        placement={placement}
        {...props}
      >
        {children}
      </Popover>
    );
  }

  return (
    <Popover
      ref={popoverRef}
      className={composeTwRenderProps(className, slots?.popover())}
      data-slot="context-menu-popover"
      isOpen={isOpen}
      offset={offset}
      placement={placement ?? 'bottom start'}
      triggerRef={anchorRef}
      onOpenChange={onOpenChange}
      {...props}
    >
      {children}
    </Popover>
  );
};

export function ContextMenuMenu<T extends object>({
  children,
  className,
  onClose,
  ...props
}: ContextMenuMenuProps<T>) {
  const { handleClose, slots } = useContext(ContextMenuContext);

  return (
    <Menu
      className={composeTwRenderProps(className, slots?.menu())}
      data-slot="context-menu-menu"
      onClose={onClose ?? handleClose}
      {...props}
    >
      {children}
    </Menu>
  );
}

export const ContextMenuSeparator = ({
  className,
  ...props
}: ContextMenuSeparatorProps) => {
  const { slots } = useContext(ContextMenuContext);

  return (
    <Separator
      className={composeSlotClassName(slots?.separator, className)}
      data-slot="context-menu-separator"
      {...props}
    />
  );
};

// Re-export HeroUI primitives under ContextMenu naming
export const ContextMenuItem = DropdownItem;
export const ContextMenuItemIndicator = DropdownItemIndicator;
export const ContextMenuSection = DropdownSection;
export const ContextMenuSubmenuTrigger = DropdownSubmenuTrigger;
export const ContextMenuSubmenuIndicator = DropdownSubmenuIndicator;
