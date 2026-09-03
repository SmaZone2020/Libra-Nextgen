import { tv } from 'tailwind-variants';

export const chatAttachmentVariants = tv({
  slots: {
    base: 'chat-attachment',
    icon: 'chat-attachment__icon',
    info: 'chat-attachment__info',
    name: 'chat-attachment__name',
    preview: 'chat-attachment__preview',
    previewImage: 'chat-attachment__preview-image',
    previewVideo: 'chat-attachment__preview-video',
    remove: 'chat-attachment__remove',
    size: 'chat-attachment__size',
  },
});

export type ChatAttachmentVariants = typeof chatAttachmentVariants;

export const chatAttachmentGroupVariants = tv({
  slots: {
    base: 'chat-attachment-group',
  },
});

export type ChatAttachmentGroupVariants = typeof chatAttachmentGroupVariants;
