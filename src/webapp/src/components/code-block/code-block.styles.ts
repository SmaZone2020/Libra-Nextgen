import { tv } from 'tailwind-variants';

export const codeBlockVariants = tv({
  slots: {
    base: 'code-block',
    code: 'code-block__code',
    copyButton: 'code-block__copy-button',
    header: 'code-block__header',
  },
});

export type CodeBlockVariants = typeof codeBlockVariants;
