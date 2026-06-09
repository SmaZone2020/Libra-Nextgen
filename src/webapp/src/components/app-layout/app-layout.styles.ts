import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const appLayoutVariants = tv({
  slots: {
    aside: 'app-layout__aside',
    asideTrigger: 'app-layout__aside-trigger',
    body: 'app-layout__body',
    footer: 'app-layout__footer',
    header: 'app-layout__header',
    main: 'app-layout__main',
    menuToggle: 'app-layout__menu-toggle',
    toolbar: 'app-layout__toolbar',
  },
});

export type AppLayoutVariants = VariantProps<typeof appLayoutVariants>;
