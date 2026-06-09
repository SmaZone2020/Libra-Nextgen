import { tv } from 'tailwind-variants';

export const chatSourceVariants = tv({
  slots: {
    base: 'chat-source',
    documentIcon: 'chat-source__document-icon',
    icon: 'chat-source__icon',
    iconFallback: 'chat-source__icon-fallback',
    preview: 'chat-source__preview',
    previewDescription: 'chat-source__preview-description',
    previewHeader: 'chat-source__preview-header',
    previewLink: 'chat-source__preview-link',
    previewTitle: 'chat-source__preview-title',
    title: 'chat-source__title',
    trigger: 'chat-source__trigger',
    triggerLink: 'chat-source__trigger-link',
  },
});

export type ChatSourceVariants = typeof chatSourceVariants;

export const chatSourcesVariants = tv({
  slots: {
    base: 'chat-sources',
    content: 'chat-sources__content',
    contentBody: 'chat-sources__content-body',
    list: 'chat-sources__list',
    trigger: 'chat-sources__trigger',
    triggerLabel: 'chat-sources__trigger-label',
  },
});

export type ChatSourcesVariants = typeof chatSourcesVariants;
