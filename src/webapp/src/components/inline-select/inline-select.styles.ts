import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const inlineSelectVariants = tv({
  slots: {
    base: 'inline-select',
    indicator: 'inline-select__indicator',
    popover: 'inline-select__popover',
    trigger: 'inline-select__trigger',
    value: 'inline-select__value',
  },
});

export type InlineSelectVariants = VariantProps<typeof inlineSelectVariants>;
