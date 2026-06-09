import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const navbarVariants = tv({
  defaultVariants: {
    maxWidth: 'lg',
    position: 'sticky',
    size: 'md',
  },
  slots: {
    base: 'navbar',
    brand: 'navbar__brand',
    content: 'navbar__content',
    header: 'navbar__header',
    item: 'navbar__item',
    label: 'navbar__label',
    menu: 'navbar__menu',
    menuItem: 'navbar__menu-item',
    menuToggle: 'navbar__menu-toggle',
    menuToggleIcon: 'navbar__menu-toggle-icon',
    separator: 'navbar__separator',
    spacer: 'navbar__spacer',
  },
  variants: {
    maxWidth: {
      '2xl': { header: 'navbar__header--max-2xl' },
      full: { header: 'navbar__header--max-full' },
      lg: { header: 'navbar__header--max-lg' },
      md: { header: 'navbar__header--max-md' },
      sm: { header: 'navbar__header--max-sm' },
      xl: { header: 'navbar__header--max-xl' },
    },
    position: {
      floating: { base: 'navbar--floating' },
      static: { base: 'navbar--static' },
      sticky: { base: 'navbar--sticky' },
    },
    size: {
      lg: {
        header: 'navbar__header--lg',
        item: 'navbar__item--lg',
        menuItem: 'navbar__menu-item--lg',
        menuToggle: 'navbar__menu-toggle--lg',
      },
      md: {
        header: 'navbar__header--md',
        item: 'navbar__item--md',
        menuItem: 'navbar__menu-item--md',
        menuToggle: 'navbar__menu-toggle--md',
      },
      sm: {
        header: 'navbar__header--sm',
        item: 'navbar__item--sm',
        menuItem: 'navbar__menu-item--sm',
        menuToggle: 'navbar__menu-toggle--sm',
      },
    },
  },
});

export type NavbarVariants = VariantProps<typeof navbarVariants>;
