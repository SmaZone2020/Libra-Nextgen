import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const promptSuggestionVariants = tv({
  defaultVariants: {
    variant: 'pill',
  },
  slots: {
    base: 'prompt-suggestion',
    description: 'prompt-suggestion__description',
    group: 'prompt-suggestion__group',
    groupDescription: 'prompt-suggestion__group-description',
    groupLabel: 'prompt-suggestion__group-label',
    header: 'prompt-suggestion__header',
    item: 'prompt-suggestion__item',
    itemDescription: 'prompt-suggestion__item-description',
    itemEndIcon: 'prompt-suggestion__item-end-icon',
    itemFooter: 'prompt-suggestion__item-footer',
    itemLabel: 'prompt-suggestion__item-label',
    itemMeta: 'prompt-suggestion__item-meta',
    itemTags: 'prompt-suggestion__item-tags',
    items: 'prompt-suggestion__items',
    title: 'prompt-suggestion__title',
  },
  variants: {
    variant: {
      card: {
        base: 'prompt-suggestion--card',
        item: 'prompt-suggestion__item--card',
        items: 'prompt-suggestion__items--card',
      },
      pill: {
        base: 'prompt-suggestion--pill',
        item: 'prompt-suggestion__item--pill',
        items: 'prompt-suggestion__items--pill',
      },
    },
  },
});

export type PromptSuggestionVariants = VariantProps<
  typeof promptSuggestionVariants
>;
