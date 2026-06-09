import type { AnyFunction, SheetPlacement } from './types';

interface Style {
  [key: string]: string;
}

const styleCache = new WeakMap<Element, Record<string, string>>();

export function isInView(el: HTMLElement): boolean {
  // not in original but declared in d.ts - provide a safe default
  const rect = el.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
}

export function set(
  el: Element | HTMLElement | null | undefined,
  styles: Style,
  ignoreCache = false
): void {
  if (!(el && el instanceof HTMLElement)) return;
  const cache: Record<string, string> = {};
  Object.entries(styles).forEach(([prop, value]) => {
    if (prop.startsWith('--')) {
      (el as HTMLElement).style.setProperty(prop, value);
    } else {
      cache[prop] = (el as HTMLElement).style[
        prop as keyof CSSStyleDeclaration
      ] as string;
      (el as unknown as Record<string, Record<string, string>>).style[prop] =
        value;
    }
  });
  if (!ignoreCache) {
    styleCache.set(el, cache);
  }
}

export function reset(el: Element | HTMLElement | null, prop?: string): void {
  if (!(el && el instanceof HTMLElement)) return;
  const cache = styleCache.get(el);
  if (cache && prop) {
    (el as unknown as Record<string, Record<string, string>>).style[prop] =
      cache[prop];
  }
}

export const isVertical = (direction: SheetPlacement): boolean => {
  switch (direction) {
    case 'top':
    case 'bottom':
      return true;
    case 'left':
    case 'right':
      return false;
    default:
      return direction as unknown as boolean;
  }
};

export function getTranslate(
  element: HTMLElement,
  direction: SheetPlacement
): number | null {
  if (!element) return null;
  const style = window.getComputedStyle(element);
  const transform =
    style.transform ||
    style.webkitTransform ||
    (style as unknown as Record<string, string>).mozTransform;
  let match = transform.match(/^matrix3d\((.+)\)$/);
  if (match) {
    return parseFloat(match[1].split(', ')[isVertical(direction) ? 13 : 12]);
  }
  match = transform.match(/^matrix\((.+)\)$/);
  if (match) {
    return parseFloat(match[1].split(', ')[isVertical(direction) ? 5 : 4]);
  }
  return null;
}

export function dampenValue(v: number): number {
  return 8 * (Math.log(v + 1) - 2);
}

export function assignStyle(
  element: HTMLElement | null | undefined,
  style: Partial<CSSStyleDeclaration>
): () => void {
  if (!element) return () => {};
  const originalCssText = element.style.cssText;
  Object.assign(element.style, style);
  return () => {
    element.style.cssText = originalCssText;
  };
}

export function chain<T>(
  ...fns: T[]
): (...args: T extends AnyFunction ? Parameters<T> : never) => void {
  return (...args) => {
    for (const fn of fns) {
      if (typeof fn === 'function') {
        (fn as AnyFunction)(...args);
      }
    }
  };
}
