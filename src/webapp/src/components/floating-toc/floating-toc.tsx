'use client';

import type { ComponentPropsWithRef, MutableRefObject, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Popover as PopoverPrimitive } from 'react-aria-components/Popover';
import { mergeRefs } from '@react-aria/utils';
import { useControlledState } from '@react-stately/utils';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { floatingTocVariants } from './floating-toc.styles';

// ---- Context ----

type FloatingTocContextValue = {
  handleCancelClose: () => void;
  handleClose: (immediate?: boolean) => void;
  handleOpen: (immediate?: boolean) => void;
  isOpen: boolean;
  isPointerInsideRef: MutableRefObject<boolean>;
  placement: 'left' | 'right';
  slots?: ReturnType<typeof floatingTocVariants>;
  triggerMode: 'hover' | 'press';
  triggerRef: MutableRefObject<Element | null>;
};

const FloatingTocContext = createContext<FloatingTocContextValue>({
  handleCancelClose: () => {},
  handleClose: () => {},
  handleOpen: () => {},
  isOpen: false,
  isPointerInsideRef: { current: false },
  placement: 'right',
  triggerMode: 'hover',
  triggerRef: { current: null },
});

// ---- Types ----

export interface FloatingTocRootProps {
  children: ReactNode;
  /** Time in ms before the floating toc closes after pointer/focus leave. @default 300 */
  closeDelay?: number;
  /** Default open state (uncontrolled). */
  defaultOpen?: boolean;
  /** Callback when open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state. */
  open?: boolean;
  /** Time in ms before the floating toc opens after hover. @default 200 */
  openDelay?: number;
  /** Which side of the page the TOC is on. Controls bar growth direction and default content side. @default "right" */
  placement?: 'left' | 'right';
  /** How the trigger opens the content. @default "hover" */
  triggerMode?: 'hover' | 'press';
}

export interface FloatingTocTriggerProps extends ComponentPropsWithRef<'span'> {}

export interface FloatingTocBarProps extends ComponentPropsWithRef<'span'> {
  /** Highlights this bar as the currently active section. */
  active?: boolean;
  /** Nesting depth (1 = top-level). Deeper levels produce shorter bars. */
  level?: number;
}

export interface FloatingTocContentProps extends Omit<
  ComponentPropsWithRef<typeof PopoverPrimitive>,
  'isOpen' | 'triggerRef'
> {}

export interface FloatingTocItemProps extends ComponentPropsWithRef<'button'> {
  /** Highlights this item as the currently active section. */
  active?: boolean;
  /** Nesting depth (1 = top-level). Deeper levels are indented. */
  level?: number;
}

// ---- Components ----

export const FloatingTocRoot = ({
  children,
  closeDelay = 300,
  defaultOpen = false,
  onOpenChange,
  open,
  openDelay = 200,
  placement = 'right',
  triggerMode = 'hover',
}: FloatingTocRootProps) => {
  const [isOpen, setIsOpen] = useControlledState(
    open,
    defaultOpen,
    onOpenChange
  );
  const triggerRef = useRef<Element | null>(null);
  const isPointerInsideRef = useRef(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const slots = useMemo(() => floatingTocVariants(), []);

  const clearTimers = useCallback(() => {
    clearTimeout(openTimerRef.current);
    clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        clearTimers();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [clearTimers, isOpen, setIsOpen]);

  const handleOpen = useCallback(
    (immediate = false) => {
      clearTimers();
      if (immediate || openDelay <= 0) {
        setIsOpen(true);
      } else {
        openTimerRef.current = setTimeout(() => setIsOpen(true), openDelay);
      }
    },
    [clearTimers, openDelay, setIsOpen]
  );

  const handleClose = useCallback(
    (immediate = false) => {
      clearTimers();
      if (immediate || closeDelay <= 0) {
        setIsOpen(false);
      } else {
        closeTimerRef.current = setTimeout(() => setIsOpen(false), closeDelay);
      }
    },
    [clearTimers, closeDelay, setIsOpen]
  );

  const handleCancelClose = useCallback(() => {
    clearTimeout(closeTimerRef.current);
  }, []);

  const contextValue = useMemo(
    () => ({
      handleCancelClose,
      handleClose,
      handleOpen,
      isOpen,
      isPointerInsideRef,
      placement,
      slots,
      triggerMode,
      triggerRef,
    }),
    [
      handleCancelClose,
      handleClose,
      handleOpen,
      isOpen,
      placement,
      slots,
      triggerMode,
    ]
  );

  return (
    <FloatingTocContext.Provider value={contextValue}>
      {children}
    </FloatingTocContext.Provider>
  );
};

export const FloatingTocTrigger = ({
  children,
  className,
  onBlur: onBlurProp,
  onClick: onClickProp,
  onFocus: onFocusProp,
  onKeyDown: onKeyDownProp,
  onPointerEnter: onPointerEnterProp,
  onPointerLeave: onPointerLeaveProp,
  ref,
  ...props
}: FloatingTocTriggerProps) => {
  const {
    handleClose,
    handleOpen,
    isOpen,
    isPointerInsideRef,
    placement,
    slots,
    triggerMode,
    triggerRef,
  } = useContext(FloatingTocContext);
  const isHover = triggerMode === 'hover';
  const mergedRef = useMemo(
    () => mergeRefs(ref, triggerRef) as React.Ref<HTMLSpanElement>,
    [ref, triggerRef]
  );

  const handlePointerEnter = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (e.pointerType === 'mouse') handleOpen();
      onPointerEnterProp?.(e);
    },
    [handleOpen, onPointerEnterProp]
  );

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (e.pointerType === 'mouse') handleClose();
      onPointerLeaveProp?.(e);
    },
    [handleClose, onPointerLeaveProp]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      if (isHover) {
        handleOpen(true);
      } else {
        isOpen ? handleClose(true) : handleOpen(true);
      }
      onClickProp?.(e);
    },
    [handleClose, handleOpen, isHover, isOpen, onClickProp]
  );

  const handleFocus = useCallback(
    (e: React.FocusEvent<HTMLSpanElement>) => {
      handleOpen(true);
      onFocusProp?.(e);
    },
    [handleOpen, onFocusProp]
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLSpanElement>) => {
      if (!isPointerInsideRef.current) handleClose();
      onBlurProp?.(e);
    },
    [handleClose, isPointerInsideRef, onBlurProp]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        isOpen ? handleClose(true) : handleOpen(true);
      }
      onKeyDownProp?.(e);
    },
    [handleClose, handleOpen, isOpen, onKeyDownProp]
  );

  return (
    <span
      ref={mergedRef}
      className={composeSlotClassName(slots?.trigger, className)}
      data-placement={placement}
      data-slot="floating-toc-trigger"
      role="button"
      tabIndex={0}
      onBlur={isHover ? handleBlur : onBlurProp}
      onClick={handleClick}
      onFocus={isHover ? handleFocus : onFocusProp}
      onKeyDown={handleKeyDown}
      onPointerEnter={isHover ? handlePointerEnter : onPointerEnterProp}
      onPointerLeave={isHover ? handlePointerLeave : onPointerLeaveProp}
      {...props}
    >
      {children}
    </span>
  );
};

export const FloatingTocBar = ({
  active,
  className,
  level,
  ref: refProp,
  style: styleProp,
  ...props
}: FloatingTocBarProps) => {
  const { slots } = useContext(FloatingTocContext);
  const localRef = useRef<HTMLSpanElement | null>(null);
  const hasActivatedRef = useRef(false);

  useEffect(() => {
    if (hasActivatedRef.current) {
      if (active && localRef.current) {
        localRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    } else {
      hasActivatedRef.current = true;
    }
  }, [active]);

  const mergedRef = useMemo(
    () => mergeRefs(refProp, localRef) as React.Ref<HTMLSpanElement>,
    [refProp]
  );
  const style =
    level != null && level > 1
      ? { ...styleProp, '--floating-toc-level': level }
      : styleProp;

  return (
    <span
      ref={mergedRef}
      className={composeSlotClassName(slots?.bar, className)}
      data-active={active || undefined}
      data-slot="floating-toc-bar"
      style={style as React.CSSProperties}
      {...props}
    />
  );
};

export const FloatingTocContent = ({
  children,
  className,
  offset = 8,
  onOpenChange: onOpenChangeProp,
  onPointerEnter: onPointerEnterProp,
  onPointerLeave: onPointerLeaveProp,
  placement: placementProp,
  ...props
}: FloatingTocContentProps) => {
  const {
    handleCancelClose,
    handleClose,
    isOpen,
    isPointerInsideRef,
    placement,
    slots,
    triggerRef,
  } = useContext(FloatingTocContext);

  const resolvedPlacement =
    placementProp ?? (placement === 'left' ? 'right' : 'left');

  const handlePointerEnter = useCallback(
    (e: React.PointerEvent<Element>) => {
      isPointerInsideRef.current = true;
      handleCancelClose();
      onPointerEnterProp?.(e as React.PointerEvent<HTMLDivElement>);
    },
    [handleCancelClose, isPointerInsideRef, onPointerEnterProp]
  );

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent<Element>) => {
      isPointerInsideRef.current = false;
      handleClose();
      onPointerLeaveProp?.(e as React.PointerEvent<HTMLDivElement>);
    },
    [handleClose, isPointerInsideRef, onPointerLeaveProp]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) handleClose(true);
      onOpenChangeProp?.(open);
    },
    [handleClose, onOpenChangeProp]
  );

  return (
    <PopoverPrimitive
      isNonModal
      className={composeTwRenderProps(className, slots?.content())}
      data-slot="floating-toc-content"
      isOpen={isOpen}
      offset={offset}
      placement={resolvedPlacement}
      triggerRef={triggerRef as React.RefObject<Element>}
      onOpenChange={handleOpenChange}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      {...props}
    >
      {(renderProps) =>
        typeof children === 'function' ? children(renderProps) : children
      }
    </PopoverPrimitive>
  );
};

export const FloatingTocItem = ({
  active,
  children,
  className,
  level,
  style: styleProp,
  ...props
}: FloatingTocItemProps) => {
  const { slots } = useContext(FloatingTocContext);
  const style =
    level != null && level > 1
      ? { ...styleProp, '--floating-toc-level': level }
      : styleProp;

  return (
    <button
      className={composeSlotClassName(slots?.item, className)}
      data-active={active || undefined}
      data-slot="floating-toc-item"
      style={style as React.CSSProperties}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
};
