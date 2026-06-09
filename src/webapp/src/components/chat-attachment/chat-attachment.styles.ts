import { tv } from 'tailwind-variants';

export const chatAttachmentVariants = tv({
  slots: {
    base: 'chat-attachment',
    name: 'chat-attachment__name',
    preview: 'chat-attachment__preview',
    previewFallback: 'chat-attachment__preview-fallback',
    previewImage: 'chat-attachment__preview-image',
    previewVideo: 'chat-attachment__preview-video',
    remove: 'chat-attachment__remove',
  },
});

export type ChatAttachmentVariants = typeof chatAttachmentVariants;

export const chatAttachmentGroupVariants = tv({
  slots: {
    base: 'chat-attachment-group',
  },
});

export type ChatAttachmentGroupVariants = typeof chatAttachmentGroupVariants;
