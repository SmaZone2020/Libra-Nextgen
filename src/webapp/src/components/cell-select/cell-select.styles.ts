import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const cellSelectVariants = tv({
  defaultVariants: {
    variant: 'default',
  },
  slots: {
    base: 'cell-select',
    indicator: 'cell-select__indicator',
    label: 'cell-select__label',
    popover: 'cell-select__popover',
    trigger: 'cell-select__trigger',
    value: 'cell-select__value',
  },
  variants: {
    variant: {
      default: {
        trigger: 'cell-select__trigger--default',
      },
      secondary: {
        trigger: 'cell-select__trigger--secondary',
      },
    },
  },
});

export type CellSelectVariants = VariantProps<typeof cellSelectVariants>;
