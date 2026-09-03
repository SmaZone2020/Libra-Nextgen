import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const chatToolVariants = tv({
  defaultVariants: { state: 'complete' },
  slots: {
    approval: 'chat-tool__approval',
    approvalActions: 'chat-tool__approval-actions',
    args: 'chat-tool__args',
    argsLabel: 'chat-tool__args-label',
    base: 'chat-tool',
    content: 'chat-tool__content',
    contentBody: 'chat-tool__content-body',
    error: 'chat-tool__error',
    errorLabel: 'chat-tool__error-label',
    meta: 'chat-tool__meta',
    result: 'chat-tool__result',
    resultLabel: 'chat-tool__result-label',
    status: 'chat-tool__status',
    trigger: 'chat-tool__trigger',
    triggerLabel: 'chat-tool__trigger-label',
  },
  variants: {
    state: {
      complete: 'chat-tool--complete',
      error: 'chat-tool--error',
      requiresAction: 'chat-tool--requires-action',
      running: 'chat-tool--running',
      streaming: 'chat-tool--streaming',
    },
  },
});

export type ChatToolVariants = VariantProps<typeof chatToolVariants>;

export const chatToolGroupVariants = tv({
  slots: {
    base: 'chat-tool-group',
    content: 'chat-tool-group__content',
    contentBody: 'chat-tool-group__content-body',
    trigger: 'chat-tool-group__trigger',
    triggerLabel: 'chat-tool-group__trigger-label',
  },
});

export type ChatToolGroupVariants = typeof chatToolGroupVariants;
