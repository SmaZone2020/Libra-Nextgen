'use client';

import React from 'react';
import { isSafari } from './browser';

let savedBodyStyles: Record<string, string> | null = null;

export function usePositionFixed({
  hasBeenOpened,
  isOpen,
  modal,
  nested,
  noBodyStyles,
  preventScrollRestoration,
}: {
  isOpen: boolean;
  modal: boolean;
  nested: boolean;
  hasBeenOpened: boolean;
  preventScrollRestoration: boolean;
  noBodyStyles: boolean;
}): {
  restorePositionSetting: () => void;
} {
  const [currentUrl, setCurrentUrl] = React.useState(() =>
    typeof window !== 'undefined' ? window.location.href : ''
  );
  const scrollYRef = React.useRef(0);

  const setPositionFixed = React.useCallback(() => {
    if (isSafari() && savedBodyStyles === null && isOpen && !noBodyStyles) {
      savedBodyStyles = {
        height: document.body.style.height,
        left: document.body.style.left,
        position: document.body.style.position,
        right: 'unset',
        top: document.body.style.top,
      };
      const { innerHeight, scrollX } = window;
      document.body.style.setProperty('position', 'fixed', 'important');
      Object.assign(document.body.style, {
        height: 'auto',
        left: -scrollX + 'px',
        right: '0px',
        top: -scrollYRef.current + 'px',
      });
      window.setTimeout(
        () =>
          window.requestAnimationFrame(() => {
            const diff = innerHeight - window.innerHeight;
            if (diff && scrollYRef.current >= innerHeight) {
              document.body.style.top = -(scrollYRef.current + diff) + 'px';
            }
          }),
        300
      );
    }
  }, [isOpen, noBodyStyles]);

  const restorePositionSetting = React.useCallback(() => {
    if (isSafari() && savedBodyStyles !== null && !noBodyStyles) {
      const scrollY = -parseInt(document.body.style.top, 10);
      const scrollX = -parseInt(document.body.style.left, 10);
      Object.assign(document.body.style, savedBodyStyles);
      window.requestAnimationFrame(() => {
        if (preventScrollRestoration && currentUrl !== window.location.href) {
          setCurrentUrl(window.location.href);
        } else {
          window.scrollTo(scrollX, scrollY);
        }
      });
      savedBodyStyles = null;
    }
  }, [currentUrl, preventScrollRestoration, noBodyStyles]);

  React.useEffect(() => {
    function trackScroll() {
      scrollYRef.current = window.scrollY;
    }
    trackScroll();
    window.addEventListener('scroll', trackScroll);
    return () => {
      window.removeEventListener('scroll', trackScroll);
    };
  }, []);

  React.useEffect(() => {
    if (modal)
      return () => {
        if (typeof document !== 'undefined') {
          if (!document.querySelector('[data-sheet-drawer]')) {
            restorePositionSetting();
          }
        }
      };
  }, [modal, restorePositionSetting]);

  React.useEffect(() => {
    if (!nested && hasBeenOpened) {
      if (isOpen) {
        if (!window.matchMedia('(display-mode: standalone)').matches) {
          setPositionFixed();
        }
        if (!modal) {
          window.setTimeout(() => {
            restorePositionSetting();
          }, 500);
        }
      } else {
        restorePositionSetting();
      }
    }
  }, [
    isOpen,
    hasBeenOpened,
    currentUrl,
    modal,
    nested,
    setPositionFixed,
    restorePositionSetting,
  ]);

  return { restorePositionSetting };
}
