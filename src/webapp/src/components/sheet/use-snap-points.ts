'use client';

import React from 'react';
import { TRANSITIONS, VELOCITY_THRESHOLD } from './constants';
import { isVertical, set } from './helpers';
import type { SheetPlacement } from './types';
import { useControlled } from './use-controlled';

export function useSnapPoints({
  activeSnapPointProp,
  container,
  direction = 'bottom',
  fadeFromIndex,
  isOpen,
  onSnapPointChange,
  overlayRef,
  setActiveSnapPointProp,
  sheetRef,
  snapPoints,
  snapToSequentialPoint,
}: {
  activeSnapPointProp?: number | string | null;
  setActiveSnapPointProp?: (snapPoint: number | null | string) => void;
  snapPoints?: (number | string)[];
  fadeFromIndex?: number;
  isOpen?: boolean;
  sheetRef: React.RefObject<HTMLDivElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onSnapPointChange: (activeSnapPointIndex: number) => void;
  direction?: SheetPlacement;
  container?: HTMLElement | null;
  snapToSequentialPoint?: boolean;
}): {
  activeSnapPoint: string | number | null;
  activeSnapPointIndex: number | null;
  getPercentageDragged: (
    absDraggedDistance: number,
    isDraggingDown: boolean
  ) => number | null;
  isLastSnapPoint: true | null;
  onDrag: ({ draggedDistance }: { draggedDistance: number }) => void;
  onRelease: ({
    closeDrawer,
    dismissible,
    draggedDistance,
    velocity,
  }: {
    draggedDistance: number;
    closeDrawer: () => void;
    velocity: number;
    dismissible: boolean;
  }) => void;
  setActiveSnapPoint: (
    newValue:
      | string
      | number
      | ((prevValue: string | number | null) => string | number | null)
      | null
  ) => void;
  shouldFade: boolean;
  snapPointsOffset: number[];
} {
  const [activeSnapPoint, setActiveSnapPoint] = useControlled<
    string | number | null
  >({
    controlled: activeSnapPointProp,
    default: snapPoints?.[0],
    onChange: setActiveSnapPointProp
      ? (val) => {
          const resolved =
            typeof val === 'function' ? val(activeSnapPointProp ?? null) : val;
          setActiveSnapPointProp(resolved);
        }
      : undefined,
  });

  const [windowSize, setWindowSize] = React.useState<
    { innerHeight: number; innerWidth: number } | undefined
  >(() =>
    typeof window !== 'undefined'
      ? { innerHeight: window.innerHeight, innerWidth: window.innerWidth }
      : undefined
  );

  const hasInitializedRef = React.useRef(false);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function onResize() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setWindowSize({
          innerHeight: window.innerHeight,
          innerWidth: window.innerWidth,
        });
      }, 100);
    }
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const isLastSnapPoint = React.useMemo(
    () => activeSnapPoint === snapPoints?.[snapPoints.length - 1] || null,
    [snapPoints, activeSnapPoint]
  );

  const activeSnapPointIndex = React.useMemo(
    () => snapPoints?.findIndex((p) => p === activeSnapPoint) ?? null,
    [snapPoints, activeSnapPoint]
  );

  const shouldFade = React.useMemo(
    () =>
      (snapPoints &&
        snapPoints.length > 0 &&
        (fadeFromIndex || fadeFromIndex === 0) &&
        !Number.isNaN(fadeFromIndex) &&
        snapPoints[fadeFromIndex] === activeSnapPoint) ||
      !snapPoints,
    [snapPoints, fadeFromIndex, activeSnapPoint]
  ) as boolean;

  const snapPointsOffset = React.useMemo<number[]>(() => {
    const containerRect = container ? container.getBoundingClientRect() : null;
    const dimensions = containerRect
      ? { height: containerRect.height, width: containerRect.width }
      : typeof window !== 'undefined'
        ? { height: window.innerHeight, width: window.innerWidth }
        : { height: 0, width: 0 };

    return (
      snapPoints?.map((point) => {
        const isString = typeof point === 'string';
        let px = 0;
        if (isString) px = parseInt(point, 10);

        if (isVertical(direction)) {
          const h = isString ? px : windowSize ? point * dimensions.height : 0;
          if (windowSize)
            return direction === 'bottom'
              ? dimensions.height - h
              : -dimensions.height + h;
          return h;
        }
        const w = isString ? px : windowSize ? point * dimensions.width : 0;
        if (windowSize)
          return direction === 'right'
            ? dimensions.width - w
            : -dimensions.width + w;
        return w;
      }) ?? []
    );
  }, [snapPoints, windowSize, container, direction]);

  const activeSnapPointOffset = React.useMemo(
    () =>
      activeSnapPointIndex !== null
        ? (snapPointsOffset?.[activeSnapPointIndex] ?? null)
        : null,
    [snapPointsOffset, activeSnapPointIndex]
  );

  const snapPointsOffsetRef = React.useRef(snapPointsOffset);
  React.useEffect(() => {
    snapPointsOffsetRef.current = snapPointsOffset;
  }, [snapPointsOffset]);

  const snapPointsRef = React.useRef(snapPoints);
  React.useEffect(() => {
    snapPointsRef.current = snapPoints;
  }, [snapPoints]);

  const snapToPoint = React.useCallback(
    (offset: number) => {
      const offsets = snapPointsOffsetRef.current;
      const points = snapPointsRef.current;
      const idx = offsets?.findIndex((o) => o === offset) ?? null;
      onSnapPointChange(idx ?? 0);
      set(sheetRef.current, {
        transform: isVertical(direction)
          ? `translate3d(0, ${offset}px, 0)`
          : `translate3d(${offset}px, 0, 0)`,
        transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
      });
      set(
        overlayRef.current,
        offsets &&
          idx !== offsets.length - 1 &&
          fadeFromIndex !== undefined &&
          idx !== fadeFromIndex &&
          idx !== null &&
          idx < (fadeFromIndex ?? 0)
          ? { '--sheet-backdrop-opacity': '0' }
          : { '--sheet-backdrop-opacity': '1' }
      );
      setActiveSnapPoint(points?.[Math.max(idx ?? 0, 0)] ?? null);
    },
    [
      sheetRef,
      fadeFromIndex,
      overlayRef,
      setActiveSnapPoint,
      direction,
      onSnapPointChange,
    ]
  );

  React.useEffect(() => {
    if (isOpen) {
      if (!hasInitializedRef.current) {
        hasInitializedRef.current = true;
        if (
          fadeFromIndex !== undefined &&
          (activeSnapPointIndex ?? 0) < fadeFromIndex
        ) {
          set(overlayRef.current, { '--sheet-backdrop-opacity': '0' });
        }
        return;
      }
      if (activeSnapPoint || activeSnapPointProp) {
        const idx =
          snapPoints?.findIndex(
            (p) => p === activeSnapPointProp || p === activeSnapPoint
          ) ?? -1;
        if (
          snapPointsOffset &&
          idx !== -1 &&
          typeof snapPointsOffset[idx] === 'number'
        ) {
          snapToPoint(snapPointsOffset[idx]);
        }
      }
    } else {
      hasInitializedRef.current = false;
    }
  }, [
    activeSnapPoint,
    activeSnapPointProp,
    activeSnapPointIndex,
    snapPoints,
    snapPointsOffset,
    snapToPoint,
    isOpen,
    fadeFromIndex,
    overlayRef,
  ]);

  return {
    activeSnapPoint,
    activeSnapPointIndex,
    getPercentageDragged(
      absDraggedDistance: number,
      isDraggingDown: boolean
    ): number | null {
      if (
        !snapPoints ||
        typeof activeSnapPointIndex !== 'number' ||
        !snapPointsOffset ||
        fadeFromIndex === undefined
      ) {
        return null;
      }
      const isLastSnapPoint = activeSnapPointIndex === snapPoints.length - 1;
      if (activeSnapPointIndex >= (fadeFromIndex ?? 0) && isDraggingDown)
        return 0;
      if (isLastSnapPoint && !isDraggingDown) return 1;
      const isFadingRange = shouldFade || !isLastSnapPoint;
      if (!isFadingRange) return null;
      const neighborIdx = isLastSnapPoint
        ? activeSnapPointIndex + 1
        : activeSnapPointIndex - 1;
      const denominator = Math.abs(
        isLastSnapPoint
          ? snapPointsOffset[neighborIdx] - snapPointsOffset[neighborIdx - 1]
          : snapPointsOffset[neighborIdx + 1] - snapPointsOffset[neighborIdx]
      );
      const ratio = absDraggedDistance / denominator;
      return isLastSnapPoint ? 1 - ratio : ratio;
    },
    isLastSnapPoint,
    onDrag({ draggedDistance }: { draggedDistance: number }) {
      if (activeSnapPointOffset === null) return;
      const newOffset =
        direction === 'bottom' || direction === 'right'
          ? activeSnapPointOffset - draggedDistance
          : activeSnapPointOffset + draggedDistance;
      if (
        (direction === 'bottom' || direction === 'right') &&
        newOffset < snapPointsOffset[snapPointsOffset.length - 1]
      )
        return;
      if (
        (direction === 'top' || direction === 'left') &&
        newOffset > snapPointsOffset[snapPointsOffset.length - 1]
      )
        return;
      set(sheetRef.current, {
        transform: isVertical(direction)
          ? `translate3d(0, ${newOffset}px, 0)`
          : `translate3d(${newOffset}px, 0, 0)`,
      });
    },
    onRelease({
      closeDrawer,
      dismissible,
      draggedDistance,
      velocity,
    }: {
      draggedDistance: number;
      closeDrawer: () => void;
      velocity: number;
      dismissible: boolean;
    }) {
      if (fadeFromIndex === undefined) return;
      const currentOffset =
        direction === 'bottom' || direction === 'right'
          ? (activeSnapPointOffset ?? 0) - draggedDistance
          : (activeSnapPointOffset ?? 0) + draggedDistance;
      const isFirstSnapPoint = activeSnapPointIndex === 0;
      const isDraggingDown = draggedDistance > 0;

      if (activeSnapPointIndex === (fadeFromIndex ?? 0) - 1) {
        set(overlayRef.current, {
          transition: `opacity ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
        });
      }

      if (!snapToSequentialPoint && velocity > 2 && !isDraggingDown) {
        if (dismissible) closeDrawer();
        else snapToPoint(snapPointsOffset[0]);
        return;
      }
      if (
        !snapToSequentialPoint &&
        velocity > 2 &&
        isDraggingDown &&
        snapPointsOffset &&
        snapPoints
      ) {
        snapToPoint(snapPointsOffset[snapPoints.length - 1]);
        return;
      }

      const nearestSnapPoint = snapPointsOffset?.reduce((prev, curr) =>
        typeof prev !== 'number' || typeof curr !== 'number'
          ? prev
          : Math.abs(curr - currentOffset) < Math.abs(prev - currentOffset)
            ? curr
            : prev
      );

      const windowDim = isVertical(direction)
        ? window.innerHeight
        : window.innerWidth;
      if (
        velocity > VELOCITY_THRESHOLD &&
        Math.abs(draggedDistance) < 0.4 * windowDim
      ) {
        const dir = isDraggingDown ? 1 : -1;
        if (dir > 0 && isLastSnapPoint && snapPoints) {
          snapToPoint(snapPointsOffset[snapPoints.length - 1]);
          return;
        }
        if (isFirstSnapPoint && dir < 0 && dismissible) closeDrawer();
        if (activeSnapPointIndex === null) return;
        snapToPoint(snapPointsOffset[activeSnapPointIndex + dir]);
        return;
      }

      if (typeof nearestSnapPoint === 'number') {
        snapToPoint(nearestSnapPoint);
      }
    },
    setActiveSnapPoint,
    shouldFade,
    snapPointsOffset,
  };
}
