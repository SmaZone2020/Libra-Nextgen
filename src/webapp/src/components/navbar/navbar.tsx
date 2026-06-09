'use client';

import type React from 'react';
import type { ComponentPropsWithRef } from 'react';
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { jsx } from 'react/jsx-runtime';
import type { ToggleButton as ToggleButtonPrimitive } from 'react-aria-components/ToggleButton';
import { ToggleButton } from 'react-aria-components/ToggleButton';
import { AnimatePresence, domAnimation, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import type { DOMRenderProps } from '@heroui/react';
import { dom, Separator } from '@heroui/react';
import { useControlledState } from '@react-stately/utils';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { AppLayoutContext } from '../app-layout/app-layout';
import type { NavbarVariants } from './navbar.styles';
import { navbarVariants } from './navbar.styles';

export type NavbarNavigate = (href: string) => void;

type NavbarContextValue = {
  height: string;
  isHidden: boolean;
  isMenuOpen: boolean;
  navigate?: NavbarNavigate;
  setMenuOpen: (open: boolean) => void;
  slots?: ReturnType<typeof navbarVariants>;
};

const NavbarContext = createContext<NavbarContextValue>({
  height: '4rem',
  isHidden: false,
  isMenuOpen: false,
  setMenuOpen: () => {},
});

export const useNavbar = (): NavbarContextValue => useContext(NavbarContext);

const hideVariants = {
  hidden: {
    transition: { damping: 40, stiffness: 400, type: 'spring' },
    y: '-100%',
  },
  visible: {
    transition: { damping: 40, stiffness: 400, type: 'spring' },
    y: 0,
  },
};

export interface NavbarRootProps
  extends ComponentPropsWithRef<'nav'>, NavbarVariants {
  children: ReactNode;
  /** Default menu open state (uncontrolled). @default false */
  defaultMenuOpen?: boolean;
  /** Navbar height CSS value. @default "4rem" */
  height?: string;
  /** Enable hide-on-scroll behavior. @default false */
  hideOnScroll?: boolean;
  /** Controlled menu open state. */
  isMenuOpen?: boolean;
  /** Programmatic navigation function for client-side routing. */
  navigate?: NavbarNavigate;
  /** Callback when menu open state changes. */
  onMenuOpenChange?: (isOpen: boolean) => void;
  /** Scroll container ref for hide-on-scroll. @default window */
  parentRef?: RefObject<HTMLElement | null>;
  /** Block background scroll when menu is open. @default true */
  shouldBlockScroll?: boolean;
}

function useHideOnScroll({
  isEnabled,
  navRef,
  parentRef,
}: {
  isEnabled: boolean;
  navRef: RefObject<HTMLElement | null>;
  parentRef?: RefObject<HTMLElement | null>;
}): boolean {
  const [isHidden, setIsHidden] = useState(false);
  const prevScrollY = useRef(0);
  const navHeight = useRef(0);

  useEffect(() => {
    if (!isEnabled) return;

    if (navRef.current) {
      navHeight.current = navRef.current.offsetHeight;
    }

    const scrollContainer = parentRef?.current ?? window;

    const handleScroll = () => {
      const scrollY = parentRef?.current
        ? parentRef.current.scrollTop
        : window.scrollY;

      setIsHidden(scrollY > prevScrollY.current && scrollY > navHeight.current);
      prevScrollY.current = scrollY;
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [isEnabled, navRef, parentRef]);

  return isHidden;
}

export const NavbarRoot = ({
  children,
  className,
  defaultMenuOpen = false,
  height = '4rem',
  hideOnScroll = false,
  isMenuOpen: isMenuOpenProp,
  maxWidth,
  navigate: navigateProp,
  onMenuOpenChange,
  parentRef,
  position,
  shouldBlockScroll = true,
  size,
  style,
  ...props
}: NavbarRootProps) => {
  const appLayoutCtx = useContext(AppLayoutContext);
  const navigate = navigateProp ?? appLayoutCtx?.navigate;

  const [isMenuOpen, setMenuOpen] = useControlledState(
    isMenuOpenProp,
    defaultMenuOpen,
    onMenuOpenChange
  );

  const slots = useMemo(
    () => navbarVariants({ maxWidth, position, size }),
    [maxWidth, position, size]
  );

  const navRef = useRef<HTMLElement>(null);
  const isHidden = useHideOnScroll({
    isEnabled: hideOnScroll,
    navRef,
    parentRef,
  });

  const shouldBlock = shouldBlockScroll && isMenuOpen;

  useEffect(() => {
    if (!shouldBlock) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [shouldBlock]);

  useEffect(() => {
    const handleResize = () => {
      if (isMenuOpen && window.innerWidth >= 768) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMenuOpen, setMenuOpen]);

  const contextValue = useMemo(
    () => ({ height, isHidden, isMenuOpen, navigate, setMenuOpen, slots }),
    [height, isHidden, isMenuOpen, navigate, setMenuOpen, slots]
  );

  const computedStyle = useMemo(
    () => ({ ...style, '--navbar-height': height }) as CSSProperties,
    [style, height]
  );

  const navProps = {
    className: composeSlotClassName(slots?.base, className),
    'data-hidden': isHidden ? 'true' : undefined,
    'data-in-app-layout': appLayoutCtx ? 'true' : undefined,
    'data-menu-open': isMenuOpen ? 'true' : undefined,
    'data-slot': 'navbar',
    ref: navRef,
    style: computedStyle,
    ...props,
  };

  return jsx(NavbarContext, {
    value: contextValue,
    children: jsx(LazyMotion, {
      features: domAnimation,
      children: hideOnScroll
        ? jsx(m.nav, {
            animate: isHidden ? 'hidden' : 'visible',
            initial: false,
            variants: hideVariants,
            ...navProps,
            children,
          })
        : jsx(dom.nav, { ...navProps, children }),
    }),
  });
};

export interface NavbarHeaderProps extends ComponentPropsWithRef<'header'> {
  children: ReactNode;
}

export const NavbarHeader = ({
  children,
  className,
  ...props
}: NavbarHeaderProps) => {
  const { slots } = useNavbar();
  return jsx('header', {
    className: composeSlotClassName(slots?.header, className),
    'data-slot': 'navbar-header',
    ...props,
    children,
  });
};

export interface NavbarBrandProps<
  E extends keyof React.JSX.IntrinsicElements = 'div',
> extends DOMRenderProps<E, undefined> {
  children: ReactNode;
  className?: string;
}

export const NavbarBrand = <
  E extends keyof React.JSX.IntrinsicElements = 'div',
>({
  children,
  className,
  ...props
}: NavbarBrandProps<E> &
  Omit<React.JSX.IntrinsicElements[E], keyof NavbarBrandProps<E>>) => {
  const { slots } = useNavbar();
  return jsx(dom.div, {
    className: composeSlotClassName(slots?.brand, className),
    'data-slot': 'navbar-brand',
    ...(props as object),
    children,
  });
};

export interface NavbarContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const NavbarContent = ({
  children,
  className,
  ...props
}: NavbarContentProps) => {
  const { slots } = useNavbar();
  return jsx('div', {
    className: composeSlotClassName(slots?.content, className),
    'data-slot': 'navbar-content',
    ...props,
    children,
  });
};

export interface NavbarItemProps<
  E extends keyof React.JSX.IntrinsicElements = 'a',
> extends DOMRenderProps<E, undefined> {
  children: ReactNode;
  className?: string;
  /** Force full page reload. @default false */
  forceReload?: boolean;
  href?: string;
  /** Marks the item as current page. @default false */
  isCurrent?: boolean;
}

export const NavbarItem = <E extends keyof React.JSX.IntrinsicElements = 'a'>({
  children,
  className,
  forceReload = false,
  href,
  isCurrent = false,
  ...props
}: NavbarItemProps<E> &
  Omit<React.JSX.IntrinsicElements[E], keyof NavbarItemProps<E>>) => {
  const { navigate, slots } = useNavbar();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!href) return;
      if (/^https?:\/\//.test(href)) {
        window.open(href, '_blank', 'noopener,noreferrer');
        e.preventDefault();
      } else if (navigate && !forceReload) {
        e.preventDefault();
        navigate(href);
      }
    },
    [href, navigate, forceReload]
  );

  return jsx(href ? dom.a : dom.button, {
    'aria-current': isCurrent ? 'page' : undefined,
    className: composeSlotClassName(slots?.item, className),
    'data-current': isCurrent ? 'true' : undefined,
    'data-slot': 'navbar-item',
    ...(href ? { href } : { type: 'button' }),
    onClick: handleClick,
    ...(props as object),
    children,
  });
};

export interface NavbarLabelProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

export const NavbarLabel = ({
  children,
  className,
  ...props
}: NavbarLabelProps) => {
  const { slots } = useNavbar();
  return jsx('span', {
    className: composeSlotClassName(slots?.label, className),
    'data-slot': 'navbar-label',
    ...props,
    children,
  });
};

export interface NavbarSeparatorProps extends ComponentPropsWithRef<
  typeof Separator
> {}

export const NavbarSeparator = ({
  className,
  ...props
}: NavbarSeparatorProps) => {
  const { slots } = useNavbar();
  return jsx(Separator, {
    className: composeSlotClassName(slots?.separator, className),
    'data-slot': 'navbar-separator',
    orientation: 'vertical',
    ...props,
  });
};

export interface NavbarSpacerProps extends ComponentPropsWithRef<'div'> {}

export const NavbarSpacer = ({ className, ...props }: NavbarSpacerProps) => {
  const { slots } = useNavbar();
  return jsx('div', {
    'aria-hidden': 'true',
    className: composeSlotClassName(slots?.spacer, className),
    'data-slot': 'navbar-spacer',
    ...props,
  });
};

export interface NavbarMenuToggleProps extends Omit<
  ComponentPropsWithRef<typeof ToggleButtonPrimitive>,
  'isSelected' | 'onChange'
> {
  children?: ReactNode;
  /** Screen-reader label. @default "Toggle navigation menu" */
  srLabel?: string;
}

export const NavbarMenuToggle = ({
  children,
  className,
  srLabel = 'Toggle navigation menu',
  ...props
}: NavbarMenuToggleProps) => {
  const { isMenuOpen, setMenuOpen, slots } = useNavbar();
  return jsx(ToggleButton, {
    'aria-label': srLabel,
    className: composeTwRenderProps(className, slots?.menuToggle()),
    'data-slot': 'navbar-menu-toggle',
    isSelected: isMenuOpen,
    onChange: setMenuOpen,
    ...props,
    children:
      children ??
      jsx('span', {
        className: slots?.menuToggleIcon(),
        'data-slot': 'navbar-menu-toggle-icon',
      }),
  });
};

const menuVariants = {
  enter: {
    height: 'calc(100dvh - var(--navbar-height))',
    opacity: 1,
    transition: { damping: 30, stiffness: 300, type: 'spring' },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.2, ease: 'easeOut' },
  },
};

export interface NavbarMenuProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const NavbarMenu = ({
  children,
  className,
  ...props
}: NavbarMenuProps) => {
  const { isMenuOpen, slots } = useNavbar();
  return jsx(AnimatePresence, {
    children:
      !!isMenuOpen &&
      jsx(m.div, {
        animate: 'enter',
        className: composeSlotClassName(slots?.menu, className),
        'data-slot': 'navbar-menu',
        exit: 'exit',
        initial: 'exit',
        variants: menuVariants,
        ...props,
        children,
      }),
  });
};

export interface NavbarMenuItemProps<
  E extends keyof React.JSX.IntrinsicElements = 'a',
> extends DOMRenderProps<E, undefined> {
  children: ReactNode;
  className?: string;
  /** Force full page reload. @default false */
  forceReload?: boolean;
  href?: string;
  /** Marks the item as current page. @default false */
  isCurrent?: boolean;
}

export const NavbarMenuItem = <
  E extends keyof React.JSX.IntrinsicElements = 'a',
>({
  children,
  className,
  forceReload = false,
  href,
  isCurrent = false,
  ...props
}: NavbarMenuItemProps<E> &
  Omit<React.JSX.IntrinsicElements[E], keyof NavbarMenuItemProps<E>>) => {
  const { navigate, setMenuOpen, slots } = useNavbar();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!href) return;
      if (/^https?:\/\//.test(href)) {
        window.open(href, '_blank', 'noopener,noreferrer');
        e.preventDefault();
      } else if (navigate && !forceReload) {
        e.preventDefault();
        navigate(href);
      }
      setMenuOpen(false);
    },
    [href, navigate, forceReload, setMenuOpen]
  );

  return jsx(href ? dom.a : dom.button, {
    'aria-current': isCurrent ? 'page' : undefined,
    className: composeSlotClassName(slots?.menuItem, className),
    'data-current': isCurrent ? 'true' : undefined,
    'data-slot': 'navbar-menu-item',
    ...(href ? { href } : { type: 'button' }),
    onClick: handleClick,
    ...(props as object),
    children,
  });
};
