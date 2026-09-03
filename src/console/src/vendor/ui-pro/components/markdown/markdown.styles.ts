import { tv } from 'tailwind-variants';

export const markdownVariants = tv({
  slots: {
    base: 'markdown',
    block: 'markdown__block',
    inlineCode: 'markdown__inline-code',
  },
});

export type MarkdownVariants = typeof markdownVariants;
