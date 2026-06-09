import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const cellSliderVariants = tv({
  defaultVariants: {
    variant: 'default',
  },
  slots: {
    base: 'cell-slider',
    fill: 'cell-slider__fill',
    label: 'cell-slider__label',
    output: 'cell-slider__output',
    thumb: 'cell-slider__thumb',
    track: 'cell-slider__track',
  },
  variants: {
    variant: {
      default: {
        track: 'cell-slider__track--default',
      },
      secondary: {
        track: 'cell-slider__track--secondary',
      },
    },
  },
});

export type CellSliderVariants = VariantProps<typeof cellSliderVariants>;
