'use client';

import React from 'react';
import type { SheetPlacement } from './types';

interface SheetContextValue {
  sheetRef: React.RefObject<HTMLDivElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onPress: (event: React.PointerEvent<HTMLDivElement>) => void;
  onRelease: (event: React.PointerEvent<HTMLDivElement> | null) => void;
  onDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
  onNestedDrag: (
    event: React.PointerEvent<HTMLDivElement>,
    percentageDragged: number
  ) => void;
  onNestedOpenChange: (o: boolean) => void;
  onNestedRelease: (
    event: React.PointerEvent<HTMLDivElement>,
    open: boolean
  ) => void;
  isDismissable: boolean;
  isOpen: boolean;
  isDragging: boolean;
  keyboardIsOpen: React.MutableRefObject<boolean>;
  snapPointsOffset: number[] | null;
  snapPoints?: (number | string)[] | null;
  activeSnapPointIndex?: number | null;
  isModal: boolean;
  shouldFade: boolean;
  activeSnapPoint?: number | string | null;
  setActiveSnapPoint: (o: number | string | null) => void;
  closeSheet: () => void;
  setIsOpen: (open: boolean) => void;
  openProp?: boolean;
  onOpenChange?: (o: boolean) => void;
  placement: SheetPlacement;
  shouldScaleBackground: boolean;
  setBackgroundColorOnScale: boolean;
  noBodyStyles: boolean;
  isHandleOnly?: boolean;
  container?: HTMLElement | null;
  shouldAutoFocus?: boolean;
  shouldAnimate?: React.RefObject<boolean>;
  isDetached: boolean;
}

export const SheetContext = React.createContext<SheetContextValue>({
  onDrag: () => {},
  isDismissable: false,
  onNestedDrag: () => {},
  isDragging: false,
  onNestedOpenChange: () => {},
  isOpen: false,
  onPress: () => {},
  keyboardIsOpen: { current: false },
  overlayRef: { current: null },
  isHandleOnly: false,
  sheetRef: { current: null },
  activeSnapPoint: null,
  isModal: false,
  onRelease: () => {},
  closeSheet: () => {},
  onNestedRelease: () => {},
  onOpenChange: () => {},
  openProp: undefined,
  container: null,
  placement: 'bottom',
  isDetached: false,
  snapPoints: null,
  noBodyStyles: false,
  snapPointsOffset: null,
  setActiveSnapPoint: () => {},
  setBackgroundColorOnScale: true,
  setIsOpen: () => {},
  shouldFade: false,
  shouldAnimate: { current: true },
  shouldAutoFocus: false,
  shouldScaleBackground: false,
});

export const useSheetContext = (): SheetContextValue => {
  const ctx = React.useContext(SheetContext);
  if (!ctx) {
    throw new Error('useSheetContext must be used within a Sheet.Root');
  }
  return ctx;
};
