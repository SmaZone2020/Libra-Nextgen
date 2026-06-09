'use client';

import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';
import React, { useMemo, useRef, useState } from 'react';
import {
  Dialog as DialogPrimitive,
  Heading as HeadingPrimitive,
} from 'react-aria-components/Dialog';
import {
  Modal as ModalPrimitive,
  ModalOverlay as ModalOverlayPrimitive,
} from 'react-aria-components/Modal';
import { CloseButton } from '@heroui/react';
import { mergeRefs } from '@react-aria/utils';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { isIOS, isMobileFirefox } from './browser';
import {
  BORDER_RADIUS,
  CLOSE_THRESHOLD,
  DRAG_CLASS,
  NESTED_DISPLACEMENT,
  SCROLL_LOCK_TIMEOUT,
  TRANSITIONS,
  VELOCITY_THRESHOLD,
  WINDOW_TOP_OFFSET,
} from './constants';
import { SheetContext, useSheetContext } from './context';
import { dampenValue, getTranslate, isVertical, reset, set } from './helpers';
import type { SheetVariants } from './sheet.styles';
import { sheetVariants } from './sheet.styles';
import type { SheetPlacement } from './types';
import { useControlled } from './use-controlled';
import { usePositionFixed } from './use-position-fixed';
import { isInput, usePreventScroll } from './use-prevent-scroll';
import { useScaleBackground } from './use-scale-background';
import { useSnapPoints } from './use-snap-points';

export interface WithFadeFromProps {
  snapPoints: (number | string)[];
  fadeFromIndex: number;
}

export interface WithoutFadeFromProps {
  snapPoints?: (number | string)[];
  fadeFromIndex?: never;
}

export type SheetRootProps = {
  activeSnapPoint?: number | string | null;
  onActiveSnapPointChange?: (snapPoint: number | string | null) => void;
  children?: React.ReactNode;
  isOpen?: boolean;
  closeThreshold?: number;
  noBodyStyles?: boolean;
  onOpenChange?: (open: boolean) => void;
  shouldScaleBackground?: boolean;
  setBackgroundColorOnScale?: boolean;
  scrollLockTimeout?: number;
  isFixed?: boolean;
  isHandleOnly?: boolean;
  isDismissable?: boolean;
  onDrag?: (
    event: React.PointerEvent<HTMLDivElement>,
    percentageDragged: number
  ) => void;
  onRelease?: (
    event: React.PointerEvent<HTMLDivElement>,
    open: boolean
  ) => void;
  isModal?: boolean;
  isNested?: boolean;
  onClose?: () => void;
  placement?: SheetPlacement;
  defaultOpen?: boolean;
  disablePreventScroll?: boolean;
  repositionInputs?: boolean;
  snapToSequentialPoint?: boolean;
  container?: HTMLElement | null;
  onAnimationEnd?: (open: boolean) => void;
  preventScrollRestoration?: boolean;
  shouldAutoFocus?: boolean;
  isDetached?: boolean;
} & (WithFadeFromProps | WithoutFadeFromProps);

export function SheetRoot({
  isOpen: isOpenProp,
  onOpenChange,
  children,
  onDrag: onDragProp,
  onRelease: onReleaseProp,
  snapPoints,
  shouldScaleBackground = false,
  setBackgroundColorOnScale = true,
  closeThreshold = CLOSE_THRESHOLD,
  scrollLockTimeout = SCROLL_LOCK_TIMEOUT,
  isDismissable = true,
  isHandleOnly = false,
  fadeFromIndex = snapPoints && snapPoints.length - 1,
  activeSnapPoint: activeSnapPointProp,
  onActiveSnapPointChange,
  isFixed,
  isModal = true,
  onClose,
  isNested,
  noBodyStyles = false,
  placement = 'bottom',
  defaultOpen = false,
  disablePreventScroll = false,
  snapToSequentialPoint = false,
  preventScrollRestoration = false,
  repositionInputs = true,
  onAnimationEnd,
  container,
  shouldAutoFocus = false,
  isDetached = false,
}: SheetRootProps) {
  const [isOpen = false, setIsOpen] = useControlled<boolean>({
    controlled: isOpenProp,
    default: defaultOpen,
    onChange: (val) => {
      const boolVal = typeof val === 'function' ? val(isOpen) : val;
      onOpenChange?.(boolVal);
      if (!boolVal && !isNested) closeSheet();
      setTimeout(() => {
        onAnimationEnd?.(boolVal);
      }, 1000 * TRANSITIONS.DURATION);
      if (boolVal && !isModal && typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          document.body.style.pointerEvents = 'auto';
        });
      }
      if (!boolVal) document.body.style.pointerEvents = 'auto';
    },
  });

  const [hasBeenOpened, setHasBeenOpened] = useState(defaultOpen);
  const [isDragging, setIsDragging] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef<HTMLDivElement | null>(null);
  const pointerStartRef = useRef(0);
  const isDraggingRef = useRef(false);
  const keyboardIsOpen = useRef(false);
  const shouldAnimate = useRef(!defaultOpen);
  const lastSnapPointReachedAt = useRef<Date | null>(null);
  const pointerStartTimeRef = useRef<Date | null>(null);
  const releaseTimeRef = useRef<Date | null>(null);
  const lastScrollTimeRef = useRef<Date | null>(null);
  const wrapperRef = useRef<Element | null>(null);
  const snapPointsCountRef = useRef(snapPoints?.length ?? 0);
  snapPointsCountRef.current = snapPoints?.length ?? 0;

  const sheetHeightRef = useRef(0);
  const sheetWidthRef = useRef(0);
  const keyboardOffsetRef = useRef(0);
  const initialSheetHeightRef = useRef(0);

  const onLastSnapPointReachedAtChange = React.useCallback((idx: number) => {
    if (
      snapPointsCountRef.current > 0 &&
      idx === snapPointsCountRef.current - 1
    ) {
      lastSnapPointReachedAt.current = new Date();
    }
  }, []);

  const {
    activeSnapPoint,
    activeSnapPointIndex,
    getPercentageDragged,
    onDrag: onSnapDrag,
    onRelease: onSnapRelease,
    setActiveSnapPoint,
    shouldFade,
    snapPointsOffset,
  } = useSnapPoints({
    activeSnapPointProp,
    container,
    direction: placement,
    fadeFromIndex: fadeFromIndex as number | undefined,
    isOpen,
    onSnapPointChange: onLastSnapPointReachedAtChange,
    overlayRef,
    setActiveSnapPointProp: onActiveSnapPointChange,
    sheetRef,
    snapPoints,
    snapToSequentialPoint,
  });

  usePreventScroll({
    isDisabled:
      !isOpen ||
      isDragging ||
      !isModal ||
      isScrolling ||
      !hasBeenOpened ||
      !repositionInputs ||
      !disablePreventScroll,
  });

  const { restorePositionSetting: closeSheet } = usePositionFixed({
    hasBeenOpened,
    isOpen,
    modal: isModal,
    nested: isNested ?? false,
    noBodyStyles,
    preventScrollRestoration,
  });

  function getWindowScale() {
    return (window.innerWidth - WINDOW_TOP_OFFSET) / window.innerWidth;
  }

  function onPress(e: React.PointerEvent<HTMLDivElement>) {
    if (isFixed || snapPoints) {
      if (!sheetRef.current || sheetRef.current.contains(e.target as Node))
        return;
      sheetHeightRef.current =
        sheetRef.current?.getBoundingClientRect().height || 0;
      sheetWidthRef.current =
        sheetRef.current?.getBoundingClientRect().width || 0;
      setIsDragging(true);
      pointerStartTimeRef.current = new Date();
      if (isIOS()) {
        window.addEventListener(
          'touchend',
          () => {
            isDraggingRef.current = false;
          },
          { once: true }
        );
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      pointerStartRef.current = isVertical(placement) ? e.pageY : e.pageX;
    }
  }

  function shouldAllowDrag(target: Element, isDraggingDown: boolean): boolean {
    let el: Element | null = target;
    const translate = sheetRef.current
      ? getTranslate(sheetRef.current, placement)
      : null;
    const now = new Date();

    if ((el as HTMLElement).tagName === 'SELECT') return false;
    if (
      (el as HTMLElement).hasAttribute('data-sheet-no-drag') ||
      (el as HTMLElement).closest('[data-sheet-no-drag]')
    )
      return false;
    if (placement === 'right' || placement === 'left') return true;
    if (
      lastSnapPointReachedAt.current &&
      now.getTime() - lastSnapPointReachedAt.current.getTime() < 500
    )
      return false;
    if (
      translate !== null &&
      (placement === 'bottom' ? translate > 0 : translate < 0)
    )
      return true;
    const selection = window.getSelection()?.toString();
    if (selection && selection.length > 0) return false;
    if (
      lastScrollTimeRef.current &&
      now.getTime() - lastScrollTimeRef.current.getTime() < scrollLockTimeout &&
      translate === 0
    ) {
      lastScrollTimeRef.current = now;
      return false;
    }
    if (isDraggingDown) {
      lastScrollTimeRef.current = now;
      return false;
    }
    while (el) {
      if (el.scrollHeight > el.clientHeight) {
        if ((el as HTMLElement).scrollTop !== 0) {
          lastScrollTimeRef.current = new Date();
          return false;
        }
        if (el.getAttribute('role') === 'dialog') return true;
      }
      el = el.parentNode as Element | null;
    }
    return true;
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (sheetRef.current && isDragging) {
      const dir = placement === 'bottom' || placement === 'right' ? 1 : -1;
      const rawDist =
        (pointerStartRef.current -
          (isVertical(placement) ? e.pageY : e.pageX)) *
        dir;
      const isDraggingDown = rawDist > 0;
      const abs = Math.abs(rawDist);
      const percentageDragged =
        abs /
        (placement === 'bottom' || placement === 'top'
          ? sheetHeightRef.current
          : sheetWidthRef.current);
      const snapPercent = getPercentageDragged(abs, isDraggingDown);
      const pct = snapPercent !== null ? snapPercent : percentageDragged;

      if (snapPoints && isDraggingDown && activeSnapPointIndex === 0) return;

      const lastDragPoint = draggingRef.current;
      if (!isDraggingRef.current) {
        if (!shouldAllowDrag(e.target as Element, isDraggingDown)) return;
        sheetRef.current.classList.add(DRAG_CLASS);
        isDraggingRef.current = true;
        set(sheetRef.current, { transition: 'none' });
        set(overlayRef.current, { transition: 'none' });
        overlayRef.current?.setAttribute('data-sheet-dragging', '');
      }

      if (snapPoints) {
        onSnapDrag({ draggedDistance: rawDist });
      }

      if (isDraggingDown && !snapPoints) {
        const dampened = dampenValue(rawDist);
        const offset = Math.min(-1 * dampened, 0) * dir;
        set(sheetRef.current, {
          transform: isVertical(placement)
            ? `translate3d(0, ${offset}px, 0)`
            : `translate3d(${offset}px, 0, 0)`,
        });
        return;
      }

      const progress = 1 - pct;
      if (
        (shouldFade ||
          (fadeFromIndex !== undefined &&
            activeSnapPointIndex === (fadeFromIndex as number) - 1)) &&
        onDragProp
      ) {
        onDragProp(e, pct);
        set(
          overlayRef.current,
          snapPoints
            ? { '--sheet-backdrop-opacity': `${progress}` }
            : { opacity: '1', transition: 'none' },
          true
        );
      }

      if (wrapperRef.current && overlayRef.current && shouldScaleBackground) {
        const scale = Math.min(
          getWindowScale() + pct * (1 - getWindowScale()),
          1
        );
        const borderRadius = 8 - 8 * pct;
        const translate = Math.max(0, 14 - 14 * pct);
        set(
          wrapperRef.current as HTMLElement,
          {
            borderRadius: `${borderRadius}px`,
            transform: isVertical(placement)
              ? `scale(${scale}) translate3d(0, ${translate}px, 0)`
              : `scale(${scale}) translate3d(${translate}px, 0, 0)`,
            transition: 'none',
          },
          true
        );
      }

      if (!snapPoints) {
        const rawOffset = abs * dir;
        set(sheetRef.current, {
          transform: isVertical(placement)
            ? `translate3d(0, ${rawOffset}px, 0)`
            : `translate3d(${rawOffset}px, 0, 0)`,
        });
      }
    }
  }

  function closeSheetFn(open?: boolean) {
    sheetRef.current?.classList.remove(DRAG_CLASS);
    overlayRef.current?.removeAttribute('data-sheet-dragging');
    isDraggingRef.current = false;
    setIsDragging(false);
    releaseTimeRef.current = new Date();
    onClose?.();
    if (snapPoints) {
      set(overlayRef.current, { '--sheet-backdrop-opacity': '0' });
    }
    if (!open) setIsOpen(false);
    setTimeout(() => {
      if (snapPoints) setActiveSnapPoint(snapPoints[0] ?? null);
    }, 1000 * TRANSITIONS.DURATION);
  }

  function snapToInitialPosition() {
    if (!sheetRef.current) return;
    const wrapper = wrapperRef.current;
    const translate = getTranslate(sheetRef.current, placement);
    set(sheetRef.current, {
      transform: 'translate3d(0, 0, 0)',
      transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
    });
    set(overlayRef.current, {
      opacity: '1',
      transition: `opacity ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
    });
    if (shouldScaleBackground && translate && translate > 0 && isOpen) {
      set(
        wrapper as HTMLElement,
        {
          borderRadius: `${BORDER_RADIUS}px`,
          overflow: 'hidden',
          ...(isVertical(placement)
            ? {
                transform: `scale(${getWindowScale()}) translate3d(0, calc(env(safe-area-inset-top) + 14px), 0)`,
                transformOrigin: 'top',
              }
            : {
                transform: `scale(${getWindowScale()}) translate3d(calc(env(safe-area-inset-top) + 14px), 0, 0)`,
                transformOrigin: 'left',
              }),
          transitionDuration: `${TRANSITIONS.DURATION}s`,
          transitionProperty: 'transform, border-radius',
          transitionTimingFunction: `cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
        },
        true
      );
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement> | null) {
    if (!isDragging || !sheetRef.current) return;
    sheetRef.current.classList.remove(DRAG_CLASS);
    overlayRef.current?.removeAttribute('data-sheet-dragging');
    isDraggingRef.current = false;
    setIsDragging(false);
    releaseTimeRef.current = new Date();

    const translate = getTranslate(sheetRef.current, placement);
    if (
      !e ||
      !shouldAllowDrag(e.target as Element, false) ||
      !translate ||
      Number.isNaN(translate)
    )
      return;
    if (!pointerStartTimeRef.current) return;

    const elapsed =
      releaseTimeRef.current.getTime() - pointerStartTimeRef.current.getTime();
    const rawDist =
      pointerStartRef.current -
      (isVertical(placement) ? (e?.pageY ?? 0) : (e?.pageX ?? 0));
    const velocity = Math.abs(rawDist) / elapsed;

    if (velocity > 0.05) {
      setIsScrolling(true);
      setTimeout(() => setIsScrolling(false), 200);
    }

    if (snapPoints) {
      onSnapRelease({
        closeDrawer: closeSheetFn,
        dismissible: isDismissable,
        draggedDistance:
          rawDist * (placement === 'bottom' || placement === 'right' ? 1 : -1),
        velocity,
      });
      onReleaseProp?.(e, true);
      return;
    }

    if (
      placement === 'bottom' || placement === 'right'
        ? rawDist > 0
        : rawDist < 0
    ) {
      snapToInitialPosition();
      onReleaseProp?.(e, true);
      return;
    }

    if (velocity > VELOCITY_THRESHOLD) {
      closeSheetFn();
      onReleaseProp?.(e, false);
      return;
    }

    const rect = sheetRef.current.getBoundingClientRect();
    const dimSize = Math.min(rect.height ?? 0, window.innerHeight);
    const widthSize = Math.min(rect.width ?? 0, window.innerWidth);
    const isLR = placement === 'left' || placement === 'right';
    if (Math.abs(translate) >= (isLR ? widthSize : dimSize) * closeThreshold) {
      closeSheetFn();
      onReleaseProp?.(e, false);
      return;
    }
    onReleaseProp?.(e, true);
    snapToInitialPosition();
  }

  function onNestedOpenChange(open: boolean) {
    const scale = open
      ? (window.innerWidth - NESTED_DISPLACEMENT) / window.innerWidth
      : 1;
    const offset = open ? -NESTED_DISPLACEMENT : 0;

    if (nestedTimeoutRef.current) window.clearTimeout(nestedTimeoutRef.current);
    set(sheetRef.current, {
      borderRadius: open ? `${BORDER_RADIUS}px` : '',
      overflow: open ? 'hidden' : '',
      transform: isVertical(placement)
        ? `scale(${scale}) translate3d(0, ${offset}px, 0)`
        : `scale(${scale}) translate3d(${offset}px, 0, 0)`,
      transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
    });

    if (!open && sheetRef.current) {
      nestedTimeoutRef.current = setTimeout(() => {
        const t = getTranslate(sheetRef.current!, placement);
        set(sheetRef.current!, {
          borderRadius: '',
          overflow: '',
          transform: isVertical(placement)
            ? `translate3d(0, ${t}px, 0)`
            : `translate3d(${t}px, 0, 0)`,
          transition: 'none',
        });
      }, 500);
    }
  }

  const nestedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onNestedDrag(e: React.PointerEvent<HTMLDivElement>, pct: number) {
    if (pct < 0) return;
    const scale = (window.innerWidth - NESTED_DISPLACEMENT) / window.innerWidth;
    const newScale = scale + pct * (1 - scale);
    const offset = pct * NESTED_DISPLACEMENT - NESTED_DISPLACEMENT;
    set(sheetRef.current, {
      transform: isVertical(placement)
        ? `scale(${newScale}) translate3d(0, ${offset}px, 0)`
        : `scale(${newScale}) translate3d(${offset}px, 0, 0)`,
      transition: 'none',
    });
  }

  function onNestedRelease(
    e: React.PointerEvent<HTMLDivElement>,
    open: boolean
  ) {
    const dim = isVertical(placement) ? window.innerHeight : window.innerWidth;
    const scale = open ? (dim - NESTED_DISPLACEMENT) / dim : 1;
    const offset = open ? -NESTED_DISPLACEMENT : 0;
    if (open) {
      set(sheetRef.current, {
        transform: isVertical(placement)
          ? `scale(${scale}) translate3d(0, ${offset}px, 0)`
          : `scale(${scale}) translate3d(${offset}px, 0, 0)`,
        transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
      });
    }
  }

  React.useEffect(() => {
    window.requestAnimationFrame(() => {
      shouldAnimate.current = true;
    });
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      setHasBeenOpened(true);
      wrapperRef.current = document.querySelector('[data-sheet-wrapper]');
    } else {
      wrapperRef.current = null;
    }
  }, [isOpen]);

  React.useEffect(() => {
    function repositionOnResize() {
      if (!sheetRef.current || !repositionInputs) return;
      const activeEl = document.activeElement;
      if (isInput(activeEl as Element) || keyboardIsOpen.current) {
        const vvHeight = window.visualViewport?.height || 0;
        const winHeight = window.innerHeight;
        let diff = winHeight - vvHeight;
        const sheetRect = sheetRef.current.getBoundingClientRect();
        const sheetH = sheetRect.height || 0;
        const sheetTop = sheetRect.top;
        const isTall = sheetH > 0.8 * winHeight;
        if (!initialSheetHeightRef.current)
          initialSheetHeightRef.current = sheetH;
        if (Math.abs(keyboardOffsetRef.current - diff) > 60) {
          keyboardIsOpen.current = !keyboardIsOpen.current;
        }
        if (
          snapPoints &&
          snapPoints.length > 0 &&
          snapPointsOffset &&
          activeSnapPointIndex != null
        ) {
          diff += snapPointsOffset[activeSnapPointIndex] || 0;
        }
        keyboardOffsetRef.current = diff;
        if (sheetH > vvHeight || keyboardIsOpen.current) {
          let targetH = sheetH;
          if (sheetH > vvHeight) {
            targetH = vvHeight - (isTall ? sheetTop : WINDOW_TOP_OFFSET);
          }
          sheetRef.current.style.height = isFixed
            ? `${sheetH - Math.max(diff, 0)}px`
            : `${Math.max(targetH, vvHeight - sheetTop)}px`;
        } else if (!isMobileFirefox()) {
          sheetRef.current.style.height = `${initialSheetHeightRef.current}px`;
        }
        sheetRef.current.style.bottom =
          snapPoints && snapPoints.length > 0 && !keyboardIsOpen.current
            ? '0px'
            : `${Math.max(diff, 0)}px`;
      }
    }
    window.visualViewport?.addEventListener('resize', repositionOnResize);
    return () =>
      window.visualViewport?.removeEventListener('resize', repositionOnResize);
  }, [
    activeSnapPointIndex,
    snapPoints,
    snapPointsOffset,
    repositionInputs,
    isFixed,
  ]);

  React.useEffect(() => {
    if (isOpen) {
      set(document.documentElement, { scrollBehavior: 'auto' });
      lastSnapPointReachedAt.current = new Date();
    }
    return () => {
      reset(document.documentElement, 'scrollBehavior');
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isModal) {
      window.requestAnimationFrame(() => {
        document.body.style.pointerEvents = 'auto';
      });
    }
  }, [isModal]);

  const callbacksRef = useRef({
    closeSheet: closeSheetFn,
    onDrag: onPointerMove,
    onNestedDrag,
    onNestedOpenChange,
    onNestedRelease,
    onPress,
    onRelease: onPointerUp,
  });
  callbacksRef.current = {
    closeSheet: closeSheetFn,
    onDrag: onPointerMove,
    onNestedDrag,
    onNestedOpenChange,
    onNestedRelease,
    onPress,
    onRelease: onPointerUp,
  };

  const stableCallbacks = useMemo(
    () => ({
      closeSheet: (...args: Parameters<typeof closeSheetFn>) =>
        callbacksRef.current.closeSheet(...args),
      onDrag: (...args: Parameters<typeof onPointerMove>) =>
        callbacksRef.current.onDrag(...args),
      onNestedDrag: (...args: Parameters<typeof onNestedDrag>) =>
        callbacksRef.current.onNestedDrag(...args),
      onNestedOpenChange: (...args: Parameters<typeof onNestedOpenChange>) =>
        callbacksRef.current.onNestedOpenChange(...args),
      onNestedRelease: (...args: Parameters<typeof onNestedRelease>) =>
        callbacksRef.current.onNestedRelease(...args),
      onPress: (...args: Parameters<typeof onPress>) =>
        callbacksRef.current.onPress(...args),
      onRelease: (...args: Parameters<typeof onPointerUp>) =>
        callbacksRef.current.onRelease(...args),
    }),
    []
  );

  const contextValue = useMemo(
    () => ({
      activeSnapPoint,
      activeSnapPointIndex,
      closeSheet: stableCallbacks.closeSheet,
      container,
      isDetached,
      isDismissable,
      isDragging,
      isHandleOnly,
      isModal,
      isOpen,
      keyboardIsOpen,
      noBodyStyles,
      onDrag: stableCallbacks.onDrag,
      onNestedDrag: stableCallbacks.onNestedDrag,
      onNestedOpenChange: stableCallbacks.onNestedOpenChange,
      onNestedRelease: stableCallbacks.onNestedRelease,
      onOpenChange,
      onPress: stableCallbacks.onPress,
      onRelease: stableCallbacks.onRelease,
      overlayRef,
      placement,
      setActiveSnapPoint,
      setBackgroundColorOnScale,
      setIsOpen,
      sheetRef,
      shouldAnimate,
      shouldAutoFocus,
      shouldFade,
      shouldScaleBackground,
      snapPoints,
      snapPointsOffset,
    }),
    [
      activeSnapPoint,
      activeSnapPointIndex,
      stableCallbacks,
      container,
      isDetached,
      isDismissable,
      isDragging,
      isHandleOnly,
      isModal,
      isOpen,
      noBodyStyles,
      onOpenChange,
      placement,
      setActiveSnapPoint,
      setBackgroundColorOnScale,
      setIsOpen,
      shouldAutoFocus,
      shouldFade,
      shouldScaleBackground,
      snapPoints,
      snapPointsOffset,
    ]
  );

  return (
    <SheetContext.Provider value={contextValue}>
      {children}
    </SheetContext.Provider>
  );
}

interface SheetTriggerProps {
  children: ReactElement<{ onPress?: () => void }>;
}

const SheetTrigger = ({
  children,
}: SheetTriggerProps): ReactElement<{ onPress?: () => void }> => {
  const { setIsOpen } = useSheetContext();
  return React.cloneElement(children, { onPress: () => setIsOpen(true) });
};

interface SheetCloseProps {
  children: ReactElement<{ onPress?: () => void }>;
}

const SheetClose = ({
  children,
}: SheetCloseProps): ReactElement<{ onPress?: () => void }> => {
  const { closeSheet } = useSheetContext();
  return React.cloneElement(children, { onPress: () => closeSheet() });
};

interface SheetBackdropProps extends Omit<
  ComponentPropsWithRef<typeof ModalOverlayPrimitive>,
  'isOpen' | 'onOpenChange'
> {
  variant?: SheetVariants['backdrop'];
}

const SheetBackdrop = ({
  children,
  className,
  ref,
  variant,
  ...rest
}: SheetBackdropProps) => {
  const {
    closeSheet,
    isDismissable,
    isModal,
    isOpen,
    onRelease,
    overlayRef,
    shouldAnimate,
    shouldFade,
    snapPoints,
  } = useSheetContext();
  const mergedRef = useMemo(
    () => mergeRefs(ref ?? null, overlayRef),
    [ref, overlayRef]
  );
  const hasSnapPoints = snapPoints && snapPoints.length > 0;
  const slots = useMemo(() => sheetVariants({ backdrop: variant }), [variant]);

  return (
    <ModalOverlayPrimitive
      ref={mergedRef}
      className={composeTwRenderProps(
        className,
        isModal ? slots?.backdrop() : ''
      )}
      data-sheet-animate={shouldAnimate?.current ? 'true' : 'false'}
      data-sheet-overlay=""
      data-sheet-snap-points={hasSnapPoints ? 'true' : 'false'}
      data-sheet-snap-points-overlay={isOpen && shouldFade ? 'true' : 'false'}
      data-slot="sheet-backdrop"
      isDismissable={isDismissable}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (isDismissable || open) {
          if (!open) closeSheet();
        }
      }}
      onMouseUp={(e) =>
        onRelease(e as unknown as React.PointerEvent<HTMLDivElement>)
      }
      {...rest}
    >
      {(renderProps) =>
        typeof children === 'function' ? children(renderProps) : children
      }
    </ModalOverlayPrimitive>
  );
};

interface SheetContentProps extends Omit<
  ComponentPropsWithRef<typeof ModalPrimitive>,
  'isOpen' | 'onOpenChange'
> {}

const SheetContent = ({
  children,
  className,
  ref,
  style,
  ...rest
}: SheetContentProps) => {
  const {
    activeSnapPointIndex,
    container,
    isDetached,
    isHandleOnly,
    isOpen,
    onDrag,
    onPress,
    onRelease,
    placement,
    sheetRef,
    shouldAnimate,
    snapPoints,
    snapPointsOffset,
  } = useSheetContext();
  const slots = useMemo(() => sheetVariants({ placement }), [placement]);
  const [delayedSnapPoints, setDelayedSnapPoints] = useState(false);
  const mergedRef = useMemo(
    () => mergeRefs(ref ?? null, sheetRef),
    [ref, sheetRef]
  );
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointerRef = useRef<React.PointerEvent<HTMLDivElement> | null>(
    null
  );
  const isMovingRef = useRef(false);
  const hasSnapPoints = snapPoints && snapPoints.length > 0;

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    startPosRef.current = null;
    isMovingRef.current = false;
    onRelease(e);
  }

  useScaleBackground();

  React.useEffect(() => {
    if (hasSnapPoints) {
      window.requestAnimationFrame(() => {
        setDelayedSnapPoints(true);
      });
    }
  }, []);

  function isDragAxis(
    delta: { x: number; y: number },
    thresh: number
  ): boolean {
    if (isMovingRef.current) return true;
    const isVertDir = isVertical(placement);
    const dirSign = ['bottom', 'right'].includes(placement) ? 1 : -1;
    if (isVertDir) {
      if (
        !(delta.y * dirSign < 0) &&
        Math.abs(delta.y) >= 0 &&
        Math.abs(delta.y) <= thresh
      ) {
        return Math.abs(delta.x) > Math.abs(delta.y);
      }
    } else {
      if (
        !(delta.x * dirSign < 0) &&
        Math.abs(delta.x) >= 0 &&
        Math.abs(delta.x) <= thresh
      ) {
        return Math.abs(delta.y) > Math.abs(delta.x);
      }
    }
    isMovingRef.current = true;
    return true;
  }

  return (
    <ModalPrimitive
      ref={mergedRef}
      className={composeTwRenderProps(className, slots?.content())}
      data-sheet-animate={shouldAnimate?.current ? 'true' : 'false'}
      data-sheet-custom-container={container ? 'true' : 'false'}
      data-sheet-delayed-snap-points={delayedSnapPoints ? 'true' : 'false'}
      data-sheet-detached={isDetached ? 'true' : undefined}
      data-sheet-drawer=""
      data-sheet-drawer-direction={placement}
      data-sheet-snap-points={isOpen && hasSnapPoints ? 'true' : 'false'}
      data-slot="sheet-content"
      {...rest}
      style={{
        ...(snapPointsOffset && snapPointsOffset.length > 0
          ? {
              '--snap-point-height': `${snapPointsOffset[activeSnapPointIndex ?? 0]}px`,
            }
          : {}),
        ...(isDetached ? { '--initial-transform': 'calc(100% + 8px)' } : {}),
        ...(style as React.CSSProperties),
      }}
      onContextMenu={(e) => {
        rest.onContextMenu?.(e);
        if (lastPointerRef.current) handlePointerUp(lastPointerRef.current);
      }}
      onPointerDown={(e) => {
        if (isHandleOnly) return;
        rest.onPointerDown?.(e);
        startPosRef.current = { x: e.pageX, y: e.pageY };
        onPress(e);
      }}
      onPointerMove={(e) => {
        lastPointerRef.current = e;
        if (isHandleOnly) return;
        rest.onPointerMove?.(e);
        if (!startPosRef.current) return;
        const dx = e.pageX - startPosRef.current.x;
        const dy = e.pageY - startPosRef.current.y;
        const pointerType = e.pointerType === 'touch' ? 10 : 2;
        if (isDragAxis({ x: dx, y: dy }, pointerType)) {
          onDrag(e);
        } else if (Math.abs(dx) > pointerType || Math.abs(dy) > pointerType) {
          startPosRef.current = null;
        }
      }}
      onPointerOut={(e) => {
        rest.onPointerOut?.(e);
        handlePointerUp(lastPointerRef.current!);
      }}
      onPointerUp={(e) => {
        rest.onPointerUp?.(e);
        startPosRef.current = null;
        isMovingRef.current = false;
        onRelease(e);
      }}
    >
      {(renderProps) =>
        typeof children === 'function' ? children(renderProps) : children
      }
    </ModalPrimitive>
  );
};

interface SheetDialogProps extends Omit<
  ComponentPropsWithRef<typeof DialogPrimitive>,
  'children'
> {
  children: ReactNode;
}

const SheetDialog = ({ children, className, ...props }: SheetDialogProps) => {
  const { placement } = useSheetContext();
  const slots = useMemo(() => sheetVariants({ placement }), [placement]);
  return (
    <DialogPrimitive
      className={composeSlotClassName(slots?.dialog, className)}
      data-placement={placement}
      data-slot="sheet-dialog"
      {...props}
    >
      {children}
    </DialogPrimitive>
  );
};

interface SheetHeaderProps extends ComponentPropsWithRef<'div'> {}

const SheetHeader = ({ children, className, ...props }: SheetHeaderProps) => {
  const { placement } = useSheetContext();
  const slots = useMemo(() => sheetVariants({ placement }), [placement]);
  return (
    <div
      className={composeSlotClassName(slots?.header, className)}
      data-slot="sheet-header"
      {...props}
    >
      {children}
    </div>
  );
};

interface SheetHeadingProps extends ComponentPropsWithRef<
  typeof HeadingPrimitive
> {}

const SheetHeading = ({ children, className, ...props }: SheetHeadingProps) => {
  const { placement } = useSheetContext();
  const slots = useMemo(() => sheetVariants({ placement }), [placement]);
  return (
    <HeadingPrimitive
      className={composeSlotClassName(slots?.heading, className)}
      data-slot="sheet-heading"
      slot="title"
      {...props}
    >
      {children}
    </HeadingPrimitive>
  );
};

interface SheetBodyProps extends ComponentPropsWithRef<'div'> {}

const SheetBody = ({ children, className, ...props }: SheetBodyProps) => {
  const { placement } = useSheetContext();
  const slots = useMemo(() => sheetVariants({ placement }), [placement]);
  return (
    <div
      className={composeSlotClassName(slots?.body, className)}
      data-slot="sheet-body"
      {...props}
    >
      {children}
    </div>
  );
};

interface SheetFooterProps extends ComponentPropsWithRef<'div'> {}

const SheetFooter = ({ children, className, ...props }: SheetFooterProps) => {
  const { placement } = useSheetContext();
  const slots = useMemo(() => sheetVariants({ placement }), [placement]);
  return (
    <div
      className={composeSlotClassName(slots?.footer, className)}
      data-slot="sheet-footer"
      {...props}
    >
      {children}
    </div>
  );
};

interface SheetHandleProps extends ComponentPropsWithRef<'div'> {
  preventCycle?: boolean;
}

const SheetHandle = ({
  children,
  className,
  preventCycle = false,
  ...rest
}: SheetHandleProps) => {
  const {
    activeSnapPoint,
    closeSheet,
    isDismissable,
    isDragging,
    isHandleOnly,
    isOpen,
    onDrag,
    onPress,
    placement,
    setActiveSnapPoint,
    snapPoints,
  } = useSheetContext();
  const slots = useMemo(() => sheetVariants({ placement }), [placement]);
  const pendingClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActiveRef = useRef(false);

  function cancelPending() {
    if (pendingClickRef.current) window.clearTimeout(pendingClickRef.current);
    longPressActiveRef.current = false;
  }

  return (
    <div
      aria-hidden="true"
      className={composeSlotClassName(slots?.handle, className)}
      data-sheet-drawer-visible={isOpen ? 'true' : 'false'}
      data-sheet-handle=""
      data-slot="sheet-handle"
      onClick={() => {
        if (longPressActiveRef.current) {
          cancelPending();
        } else {
          window.setTimeout(() => {
            function cycleSnapPoint() {
              if (isDragging || preventCycle || longPressActiveRef.current)
                return cancelPending();
              cancelPending();
              if (!snapPoints || snapPoints.length === 0) {
                if (isDismissable) closeSheet();
                return;
              }
              if (
                activeSnapPoint === snapPoints[snapPoints.length - 1] &&
                isDismissable
              ) {
                closeSheet();
                return;
              }
              const idx = snapPoints.findIndex((p) => p === activeSnapPoint);
              if (idx !== -1) setActiveSnapPoint(snapPoints[idx + 1] ?? null);
            }
            cycleSnapPoint();
          }, 120);
        }
      }}
      onPointerCancel={cancelPending}
      onPointerDown={(e) => {
        if (isHandleOnly) onPress(e);
        pendingClickRef.current = setTimeout(() => {
          longPressActiveRef.current = true;
        }, 250);
      }}
      onPointerMove={(e) => {
        if (isHandleOnly) onDrag(e);
      }}
      {...rest}
    >
      <span aria-hidden="true" data-slot="sheet-handle-hitarea">
        {children ?? (
          <span
            className={composeSlotClassName(slots?.handleBar, undefined)}
            data-slot="sheet-handle-bar"
          />
        )}
      </span>
    </div>
  );
};

interface SheetCloseTriggerProps extends ComponentPropsWithRef<
  typeof CloseButton
> {}

const SheetCloseTrigger = ({
  children,
  className,
  ...props
}: SheetCloseTriggerProps) => {
  const { closeSheet, placement } = useSheetContext();
  const slots = useMemo(() => sheetVariants({ placement }), [placement]);
  return (
    <CloseButton
      className={composeTwRenderProps(className, slots?.closeTrigger())}
      data-slot="sheet-close-trigger"
      onPress={() => closeSheet()}
      {...props}
    >
      {children}
    </CloseButton>
  );
};

export function SheetNestedRoot({
  isOpen: nestedIsOpen,
  onDrag,
  onOpenChange,
  ...rest
}: SheetRootProps) {
  const { onNestedDrag, onNestedOpenChange, onNestedRelease } =
    useSheetContext();
  if (!onNestedDrag) {
    throw new Error('Sheet.NestedRoot must be placed in another Sheet');
  }
  return (
    <SheetRoot
      isNested
      isOpen={nestedIsOpen}
      onRelease={onNestedRelease}
      onClose={() => {
        onNestedOpenChange(false);
      }}
      onDrag={(e, pct) => {
        onNestedDrag(e, pct);
        onDrag?.(e, pct);
      }}
      onOpenChange={(open) => {
        if (open) onNestedOpenChange(open);
        onOpenChange?.(open);
      }}
      {...rest}
    />
  );
}

export {
  SheetBackdrop,
  SheetBody,
  SheetClose,
  SheetCloseTrigger,
  SheetContent,
  SheetDialog,
  SheetFooter,
  SheetHandle,
  SheetHeader,
  SheetHeading,
  SheetTrigger,
};
export type {
  SheetBackdropProps,
  SheetBodyProps,
  SheetCloseProps,
  SheetCloseTriggerProps,
  SheetContentProps,
  SheetDialogProps,
  SheetFooterProps,
  SheetHandleProps,
  SheetHeaderProps,
  SheetHeadingProps,
  SheetTriggerProps,
};
