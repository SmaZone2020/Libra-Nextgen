import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const emojiPickerVariants = tv({
  defaultVariants: { size: 'md' },
  slots: {
    content: 'emoji-picker__content',
    empty: 'emoji-picker__empty',
    footer: 'emoji-picker__footer',
    grid: 'emoji-picker__grid',
    item: 'emoji-picker__item',
    popover: 'emoji-picker__popover',
    skinToneOption: 'emoji-picker__skin-tone-option',
    skinToneOptions: 'emoji-picker__skin-tone-options',
    skinTonePicker: 'emoji-picker__skin-tone-picker',
    trigger: 'emoji-picker__trigger',
    value: 'emoji-picker__value',
  },
  variants: {
    size: {
      lg: {
        item: 'emoji-picker__item--lg',
        popover: 'emoji-picker__popover--lg',
      },
      md: {
        item: 'emoji-picker__item--md',
        popover: 'emoji-picker__popover--md',
      },
      sm: {
        item: 'emoji-picker__item--sm',
        popover: 'emoji-picker__popover--sm',
      },
    },
  },
});

export type EmojiPickerVariants = VariantProps<typeof emojiPickerVariants>;
