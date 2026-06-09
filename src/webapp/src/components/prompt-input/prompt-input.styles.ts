import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const promptInputVariants = tv({
  defaultVariants: {
    size: 'md',
    variant: 'primary',
  },
  slots: {
    attachments: 'prompt-input__attachments',
    base: 'prompt-input',
    content: 'prompt-input__content',
    footer: 'prompt-input__footer',
    queue: 'prompt-input__queue',
    queueItem: 'prompt-input__queue-item',
    queueItemActions: 'prompt-input__queue-item-actions',
    queueItemAttachments: 'prompt-input__queue-item-attachments',
    queueItemAttachmentsOverflow:
      'prompt-input__queue-item-attachments-overflow',
    queueItemBody: 'prompt-input__queue-item-body',
    queueItemContent: 'prompt-input__queue-item-content',
    queueItemDescription: 'prompt-input__queue-item-description',
    queueItemHandle: 'prompt-input__queue-item-handle',
    queueItemIcon: 'prompt-input__queue-item-icon',
    queueList: 'prompt-input__queue-list',
    send: 'prompt-input__send',
    shell: 'prompt-input__shell',
    textarea:
      'prompt-input__textarea border-0 bg-transparent shadow-none outline-none ring-0 hover:border-transparent hover:bg-transparent focus:border-transparent focus:bg-transparent focus:shadow-none focus:ring-0 focus-visible:ring-0 data-[focused=true]:border-transparent data-[hovered=true]:border-transparent data-[focused=true]:bg-transparent data-[hovered=true]:bg-transparent data-[focused=true]:shadow-none data-[focused=true]:ring-0',
    toolbar: 'prompt-input__toolbar',
    toolbarEnd: 'prompt-input__toolbar-end',
    toolbarStart: 'prompt-input__toolbar-start',
  },
  variants: {
    size: {
      lg: { base: 'prompt-input--lg' },
      md: {},
      sm: { base: 'prompt-input--sm' },
    },
    variant: {
      inline: { shell: 'prompt-input__shell--inline' },
      primary: { shell: 'prompt-input__shell--primary' },
      secondary: { shell: 'prompt-input__shell--secondary' },
    },
  },
});

export type PromptInputVariants = VariantProps<typeof promptInputVariants>;
