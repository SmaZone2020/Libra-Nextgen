import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const cellSwitchVariants = tv({
  defaultVariants: {
    variant: 'default',
  },
  slots: {
    base: 'cell-switch',
    control: 'cell-switch__control',
    label: 'cell-switch__label',
    trigger: 'cell-switch__trigger',
  },
  variants: {
    variant: {
      default: {
        trigger: 'cell-switch__trigger--default',
      },
      secondary: {
        base: 'cell-switch--secondary',
        control: 'cell-switch__control--secondary',
        trigger: 'cell-switch__trigger--secondary',
      },
    },
  },
});

export type CellSwitchVariants = VariantProps<typeof cellSwitchVariants>;
