import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const commandVariants = tv({
  defaultVariants: { size: 'md', variant: 'opaque' },
  slots: {
    backdrop: 'command__backdrop',
    container: 'command__container',
    dialog: 'command__dialog',
    empty: 'command__empty',
    footer: 'command__footer',
    group: 'command__group',
    groupHeading: 'command__group-heading',
    header: 'command__header',
    inputGroup: 'command__input-group',
    inputGroupClearButton: 'command__input-group-clear-button',
    inputGroupInput: 'command__input-group-input',
    inputGroupPrefix: 'command__input-group-prefix',
    inputGroupSuffix: 'command__input-group-suffix',
    item: 'command__item',
    list: 'command__list',
    separator: 'command__separator',
  },
  variants: {
    size: {
      sm: { dialog: 'command__dialog--sm' },
      md: { dialog: 'command__dialog--md' },
      lg: { dialog: 'command__dialog--lg' },
    },
    variant: {
      blur: { backdrop: 'command__backdrop--blur' },
      opaque: { backdrop: 'command__backdrop--opaque' },
      transparent: { backdrop: 'command__backdrop--transparent' },
    },
  },
});

export type CommandVariants = VariantProps<typeof commandVariants>;
