import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const hoverCardVariants = tv({
  slots: {
    arrow: 'hover-card__arrow',
    content: 'hover-card__content',
    trigger: 'hover-card__trigger',
  },
});

export type HoverCardVariants = VariantProps<typeof hoverCardVariants>;
