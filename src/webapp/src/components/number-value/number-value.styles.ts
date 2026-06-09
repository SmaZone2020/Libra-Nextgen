import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const numberValueVariants = tv({
  slots: {
    base: 'number-value',
    prefix: 'number-value__prefix',
    suffix: 'number-value__suffix',
    value: 'number-value__value',
  },
});

export type NumberValueVariants = VariantProps<typeof numberValueVariants>;
