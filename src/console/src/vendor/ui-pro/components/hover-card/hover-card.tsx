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
import {
  OverlayArrow as OverlayArrowPrimitive,
  Popover as PopoverPrimitive,
} from 'react-aria-components/Popover';
import { mergeRefs } from '@react-aria/utils';
import { useControlledState } from '@react-stately/utils';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { hoverCardVariants } from './hover-card.styles';

// ---- Context ----

type HoverCardContextValue = {
  handleCancelClose: () => void;
  handleClose: (immediate?: boolean) => void;
  handleOpen: (immediate?: boolean) => void;
  isOpen: boolean;
  isPointerInsideRef: MutableRefObject<boolean>;
  slots?: ReturnType<typeof hoverCardVariants>;
  triggerRef: MutableRefObject<Element | null>;
};

const HoverCardContext = createContext<HoverCardContextValue>({
  handleCancelClose: () => {},
  handleClose: () => {},
  handleOpen: () => {},
  isOpen: false,
  isPointerInsideRef: { current: false },
  triggerRef: { current: null },
});

// ---- Types ----

export interface HoverCardRootProps {
  children: ReactNode;
  /** Time in ms before the hover card closes after pointer/focus leave. @default 300 */
  closeDelay?: number;
  /** Default open state (uncontrolled). */
  defaultOpen?: boolean;
  /** Callback when open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Controlled open state. */
  open?: boolean;
  /** Time in ms before the hover card opens after hover. @default 700 */
  openDelay?: number;
}

export interface HoverCardTriggerProps extends ComponentPropsWithRef<'span'> {}

export interface HoverCardContentProps extends Omit<
  ComponentPropsWithRef<typeof PopoverPrimitive>,
  'isOpen' | 'triggerRef'
> {}

export interface HoverCardArrowProps extends ComponentPropsWithRef<
  typeof OverlayArrowPrimitive
> {}

// ---- Components ----

export const HoverCardRoot = ({
  children,
  closeDelay = 300,
  defaultOpen = false,
  onOpenChange,
  open,
  openDelay = 700,
}: HoverCardRootProps) => {
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
  const slots = useMemo(() => hoverCardVariants(), []);

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
      slots,
      triggerRef,
    }),
    [handleCancelClose, handleClose, handleOpen, isOpen, slots]
  );

  return (
    <HoverCardContext.Provider value={contextValue}>
      {children}
    </HoverCardContext.Provider>
  );
};

export const HoverCardTrigger = ({
  children,
  className,
  onBlur: onBlurProp,
  onFocus: onFocusProp,
  onPointerEnter: onPointerEnterProp,
  onPointerLeave: onPointerLeaveProp,
  ref,
  ...props
}: HoverCardTriggerProps) => {
  const { handleClose, handleOpen, isPointerInsideRef, slots, triggerRef } =
    useContext(HoverCardContext);
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

  return (
    <span
      ref={mergedRef}
      className={composeSlotClassName(slots?.trigger, className)}
      data-slot="hover-card-trigger"
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      {...props}
    >
      {children}
    </span>
  );
};

export const HoverCardContent = ({
  children,
  className,
  offset = 8,
  onOpenChange: onOpenChangeProp,
  onPointerEnter: onPointerEnterProp,
  onPointerLeave: onPointerLeaveProp,
  placement = 'top',
  ...props
}: HoverCardContentProps) => {
  const {
    handleCancelClose,
    handleClose,
    isOpen,
    isPointerInsideRef,
    slots,
    triggerRef,
  } = useContext(HoverCardContext);

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
      data-slot="hover-card-content"
      isOpen={isOpen}
      offset={offset}
      placement={placement}
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

export const HoverCardArrow = ({
  children,
  className,
  ...props
}: HoverCardArrowProps) => {
  const { slots } = useContext(HoverCardContext);
  return (
    <OverlayArrowPrimitive
      className={composeTwRenderProps(className, slots?.arrow())}
      data-slot="hover-card-arrow"
      {...props}
    >
      {children ?? (
        <svg
          fill="none"
          height="12"
          viewBox="0 0 12 12"
          width="12"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 0C5.48483 8 6.5 8 12 0Z" />
        </svg>
      )}
    </OverlayArrowPrimitive>
  );
};
