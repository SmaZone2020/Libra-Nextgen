'use client';

import { useEffect, useLayoutEffect } from 'react';
import { isIOS } from './browser';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function chain(...fns: Array<(...args: unknown[]) => void>) {
  return (...args: unknown[]) => {
    for (const fn of fns) {
      if (typeof fn === 'function') fn(...args);
    }
  };
}

const visualViewport = typeof document !== 'undefined' && window.visualViewport;

export function isScrollable(node: Element): boolean {
  const style = window.getComputedStyle(node);
  return /(auto|scroll)/.test(
    style.overflow + style.overflowX + style.overflowY
  );
}

export function getScrollParent(node: Element): Element {
  let current: Element | null = node;
  if (isScrollable(current)) {
    current = current.parentElement;
  }
  while (current && !isScrollable(current)) {
    current = current.parentElement;
  }
  return current || document.scrollingElement || document.documentElement;
}

const INPUT_TYPES_NOT_TO_REPOSITION = new Set([
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'image',
  'button',
  'submit',
  'reset',
]);

export function isInput(target: Element): boolean {
  return (
    (target instanceof HTMLInputElement &&
      !INPUT_TYPES_NOT_TO_REPOSITION.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

let removeScrollFn: (() => void) | undefined;
let lockCount = 0;

interface PreventScrollOptions {
  isDisabled?: boolean;
}

export function usePreventScroll(options: PreventScrollOptions = {}): void {
  const { isDisabled } = options;

  useIsomorphicLayoutEffect(() => {
    if (isDisabled) return;
    lockCount++;
    if (lockCount === 1 && isIOS()) {
      removeScrollFn = lockScrollForIOS();
    }
    return () => {
      lockCount--;
      if (lockCount === 0) {
        removeScrollFn?.();
      }
    };
  }, [isDisabled]);
}

function setStyle(el: HTMLElement, prop: string, value: string): () => void {
  const original = (el.style as unknown as Record<string, string>)[prop];
  (el.style as unknown as Record<string, string>)[prop] = value;
  return () => {
    (el.style as unknown as Record<string, string>)[prop] = original;
  };
}

function addListener(
  el: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean
): () => void {
  el.addEventListener(type, handler, options);
  return () => {
    el.removeEventListener(type, handler, options);
  };
}

function scrollIntoView(target: Element): void {
  const scrollable = document.scrollingElement || document.documentElement;
  for (let el: Element | null = target; el && el !== scrollable; ) {
    const parent = getScrollParent(el);
    if (
      parent !== document.documentElement &&
      parent !== document.body &&
      parent !== el
    ) {
      const parentTop = parent.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      if (
        el.getBoundingClientRect().bottom >
        parent.getBoundingClientRect().bottom + 24
      ) {
        (parent as HTMLElement).scrollTop += elTop - parentTop;
      }
    }
    el = (parent as HTMLElement).parentElement;
  }
}

function lockScrollForIOS(): () => void {
  let scrollParent: Element | null = null;
  let lastY = 0;
  const pageX = window.pageXOffset;
  const pageY = window.pageYOffset;

  const restoreOverflow = chain(
    setStyle(
      document.documentElement,
      'paddingRight',
      `${window.innerWidth - document.documentElement.clientWidth}px`
    ),
    setStyle(document.documentElement, 'overflow', 'hidden')
  );

  window.scrollTo(0, 0);

  const removeListeners = chain(
    addListener(
      document,
      'touchstart',
      (e: Event) => {
        const te = e as TouchEvent;
        scrollParent = getScrollParent(te.target as Element);
        if (
          scrollParent === document.documentElement ||
          scrollParent === document.body
        )
          return;
        lastY = te.changedTouches[0].pageY;
      },
      { capture: true, passive: false }
    ),
    addListener(
      document,
      'touchmove',
      (e: Event) => {
        const te = e as TouchEvent;
        if (
          !scrollParent ||
          scrollParent === document.documentElement ||
          scrollParent === document.body
        ) {
          te.preventDefault();
          return;
        }
        const y = te.changedTouches[0].pageY;
        const scrollTop = (scrollParent as HTMLElement).scrollTop;
        const maxScroll =
          (scrollParent as HTMLElement).scrollHeight -
          (scrollParent as HTMLElement).clientHeight;
        if (maxScroll !== 0) {
          if (
            (scrollTop <= 0 && y > lastY) ||
            (scrollTop >= maxScroll && y < lastY)
          ) {
            te.preventDefault();
          }
          lastY = y;
        }
      },
      { capture: true, passive: false }
    ),
    addListener(
      document,
      'touchend',
      (e: Event) => {
        const te = e as TouchEvent;
        const target = te.target as Element;
        if (isInput(target) && target !== document.activeElement) {
          te.preventDefault();
          (target as HTMLElement).style.transform = 'translateY(-2000px)';
          (target as HTMLElement).focus();
          requestAnimationFrame(() => {
            (target as HTMLElement).style.transform = '';
          });
        }
      },
      { capture: true, passive: false }
    ),
    addListener(
      document,
      'focus',
      (e: Event) => {
        const target = (e as FocusEvent).target as Element;
        if (isInput(target)) {
          (target as HTMLElement).style.transform = 'translateY(-2000px)';
          requestAnimationFrame(() => {
            (target as HTMLElement).style.transform = '';
            if (visualViewport) {
              if (visualViewport.height < window.innerHeight) {
                requestAnimationFrame(() => scrollIntoView(target));
              } else {
                visualViewport.addEventListener(
                  'resize',
                  () => scrollIntoView(target),
                  { once: true }
                );
              }
            }
          });
        }
      },
      true
    ),
    addListener(window, 'scroll', () => {
      window.scrollTo(0, 0);
    })
  );

  return () => {
    restoreOverflow();
    removeListeners();
    window.scrollTo(pageX, pageY);
  };
}

export { useIsomorphicLayoutEffect };
