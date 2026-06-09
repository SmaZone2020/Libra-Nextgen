import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const cellColorPickerVariants = tv({
  defaultVariants: {
    variant: 'default',
  },
  slots: {
    base: 'cell-color-picker',
    label: 'cell-color-picker__label',
    popover: 'cell-color-picker__popover',
    swatch: 'cell-color-picker__swatch',
    trigger: 'cell-color-picker__trigger',
    valueDisplay: 'cell-color-picker__value-display',
  },
  variants: {
    variant: {
      default: {
        trigger: 'cell-color-picker__trigger--default',
      },
      secondary: {
        trigger: 'cell-color-picker__trigger--secondary',
      },
    },
  },
});

export type CellColorPickerVariants = VariantProps<
  typeof cellColorPickerVariants
>;
