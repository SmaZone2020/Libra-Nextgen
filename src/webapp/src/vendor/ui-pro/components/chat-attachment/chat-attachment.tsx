'use client';

import type { ComponentPropsWithRef, ComponentType, SVGProps } from 'react';
import React, { createContext, useContext, useMemo } from 'react';
import { cx } from 'tailwind-variants';
import { CloseButton } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import {
  FileAudio,
  FileCode,
  FileDoc,
  FileImage,
  FilePdf,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FileZip,
} from '../icons';
import { chatAttachmentVariants } from './chat-attachment.styles';

export type ChatAttachmentMediaType =
  | 'audio'
  | 'document'
  | 'image'
  | 'unknown'
  | 'video';

export type ChatAttachmentFileKind =
  | 'archive'
  | 'audio'
  | 'code'
  | 'document'
  | 'image'
  | 'pdf'
  | 'presentation'
  | 'spreadsheet'
  | 'unknown'
  | 'video';

export type ChatAttachmentVariant = 'file' | 'media';

export function inferChatAttachmentMediaType(
  mimeType?: string
): ChatAttachmentMediaType {
  if (!mimeType) return 'unknown';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/') || mimeType.startsWith('application/'))
    return 'document';
  return 'unknown';
}

const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'avif',
  'heic',
  'ico',
  'tiff',
];
const VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'm4v',
  'mpg',
  'mpeg',
];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus'];
const ARCHIVE_EXTENSIONS = [
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
];
const SPREADSHEET_EXTENSIONS = ['csv', 'tsv', 'xls', 'xlsx', 'ods', 'numbers'];
const DOCUMENT_EXTENSIONS = ['doc', 'docx', 'odt', 'rtf', 'pages'];
const PRESENTATION_EXTENSIONS = ['ppt', 'pptx', 'odp', 'key'];
const CODE_EXTENSIONS = [
  'js',
  'jsx',
  'ts',
  'tsx',
  'json',
  'html',
  'css',
  'scss',
  'sass',
  'less',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'yml',
  'yaml',
  'toml',
  'xml',
  'sql',
  'vue',
  'svelte',
];

function getFileExtension(name?: string): string {
  return name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

export function inferChatAttachmentFileKind(
  mimeType?: string,
  name?: string
): ChatAttachmentFileKind {
  const mime = mimeType?.toLowerCase() ?? '';
  const ext = getFileExtension(name);

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext))
    return 'image';
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext))
    return 'video';
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext))
    return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    ARCHIVE_EXTENSIONS.includes(ext) ||
    /zip|compressed|x-tar|x-7z|x-rar|gzip/.test(mime)
  )
    return 'archive';
  if (
    SPREADSHEET_EXTENSIONS.includes(ext) ||
    /spreadsheet|ms-excel|csv/.test(mime)
  )
    return 'spreadsheet';
  if (
    PRESENTATION_EXTENSIONS.includes(ext) ||
    /presentation|ms-powerpoint/.test(mime)
  )
    return 'presentation';
  if (
    DOCUMENT_EXTENSIONS.includes(ext) ||
    /msword|wordprocessing|rtf/.test(mime)
  )
    return 'document';
  if (
    CODE_EXTENSIONS.includes(ext) ||
    /javascript|typescript|json|x-sh|x-python|xml/.test(mime)
  )
    return 'code';
  if (mime.startsWith('text/')) return 'document';
  return 'unknown';
}

export function formatChatAttachmentSize(bytes?: number): string | undefined {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const FILE_KIND_ICONS: Record<ChatAttachmentFileKind, IconComponent> = {
  archive: FileZip,
  audio: FileAudio,
  code: FileCode,
  document: FileDoc,
  image: FileImage,
  pdf: FilePdf,
  presentation: FileDoc,
  spreadsheet: FileSpreadsheet,
  unknown: FileText,
  video: FileVideo,
};

interface ChatAttachmentContextValue {
  fileKind: ChatAttachmentFileKind;
  mediaType: ChatAttachmentMediaType;
  mimeType?: string;
  name?: string;
  size?: number;
  slots: ReturnType<typeof chatAttachmentVariants>;
  src?: string;
  variant: ChatAttachmentVariant;
}

const ChatAttachmentContext = createContext({} as ChatAttachmentContextValue);

const useChatAttachmentContext = () => useContext(ChatAttachmentContext);
const useSlots = () => {
  const { slots } = useChatAttachmentContext();
  const fallback = useMemo(() => chatAttachmentVariants(), []);
  return slots ?? fallback;
};

export interface ChatAttachmentRootProps extends ComponentPropsWithRef<'div'> {
  children?: React.ReactNode;
  mediaType?: ChatAttachmentMediaType;
  mimeType?: string;
  name?: string;
  size?: number;
  src?: string;
}

export type ChatAttachmentPreviewProps = {
  children?: React.ReactNode;
  className?: string;
};

export interface ChatAttachmentIconProps extends ComponentPropsWithRef<'span'> {
  children?: React.ReactNode;
}

export interface ChatAttachmentInfoProps extends ComponentPropsWithRef<'div'> {
  children?: React.ReactNode;
}

export interface ChatAttachmentNameProps extends ComponentPropsWithRef<'span'> {
  children?: React.ReactNode;
}

export interface ChatAttachmentSizeProps extends ComponentPropsWithRef<'span'> {
  children?: React.ReactNode;
}

export type ChatAttachmentRemoveProps = ComponentPropsWithRef<
  typeof CloseButton
>;

export const ChatAttachmentRoot = ({
  children,
  className,
  mediaType,
  mimeType,
  name,
  size,
  src,
  ...props
}: ChatAttachmentRootProps) => {
  const slots = useMemo(() => chatAttachmentVariants(), []);
  const fileKind = inferChatAttachmentFileKind(mimeType, name);
  const inferredMediaType = mediaType ?? inferChatAttachmentMediaType(mimeType);
  const resolvedMediaType =
    inferredMediaType !== 'unknown' ||
    (fileKind !== 'image' && fileKind !== 'video')
      ? inferredMediaType
      : fileKind;
  const variant: ChatAttachmentVariant =
    (resolvedMediaType !== 'image' && resolvedMediaType !== 'video') || !src
      ? 'file'
      : 'media';

  return (
    <ChatAttachmentContext.Provider
      value={{
        fileKind,
        mediaType: resolvedMediaType,
        mimeType,
        name,
        size,
        slots,
        src,
        variant,
      }}
    >
      <div
        className={composeSlotClassName(slots?.base, className)}
        data-media-type={resolvedMediaType}
        data-slot="chat-attachment"
        data-variant={variant}
        title={name}
        {...props}
      >
        {children ?? (
          <>
            <ChatAttachmentPreview />
            <ChatAttachmentInfo />
          </>
        )}
      </div>
    </ChatAttachmentContext.Provider>
  );
};

export const ChatAttachmentPreview = ({
  children,
  className,
}: ChatAttachmentPreviewProps) => {
  const { mediaType, name, src } = useChatAttachmentContext();
  const slots = useSlots();

  if (children && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<{ className?: string }>,
      {
        className: cx(
          composeSlotClassName(slots?.preview, className),
          (children as React.ReactElement<{ className?: string }>).props
            .className
        ),
        'data-slot': 'chat-attachment-preview',
      } as React.HTMLAttributes<HTMLElement>
    );
  }

  return (
    <div
      className={composeSlotClassName(slots?.preview, className)}
      data-slot="chat-attachment-preview"
    >
      {mediaType === 'image' && src ? (
        <img
          alt={name ?? 'Attachment'}
          className={composeSlotClassName(slots?.previewImage, undefined)}
          data-slot="chat-attachment-preview-image"
          src={src}
        />
      ) : mediaType === 'video' && src ? (
        <video
          className={composeSlotClassName(slots?.previewVideo, undefined)}
          data-slot="chat-attachment-preview-video"
          muted
          src={src}
        />
      ) : (
        <ChatAttachmentIcon />
      )}
    </div>
  );
};

export const ChatAttachmentIcon = ({
  children,
  className,
  ...props
}: ChatAttachmentIconProps) => {
  const { fileKind = 'unknown' } = useChatAttachmentContext();
  const slots = useSlots();
  const Icon = FILE_KIND_ICONS[fileKind] ?? FileText;

  return (
    <span
      className={composeSlotClassName(slots?.icon, className)}
      data-slot="chat-attachment-icon"
      {...props}
    >
      {children ?? <Icon />}
    </span>
  );
};

export const ChatAttachmentInfo = ({
  children,
  className,
  ...props
}: ChatAttachmentInfoProps) => {
  const slots = useSlots();

  return (
    <div
      className={composeSlotClassName(slots?.info, className)}
      data-slot="chat-attachment-info"
      {...props}
    >
      {children ?? (
        <>
          <ChatAttachmentName />
          <ChatAttachmentSize />
        </>
      )}
    </div>
  );
};

export const ChatAttachmentName = ({
  children,
  className,
  ...props
}: ChatAttachmentNameProps) => {
  const { name } = useChatAttachmentContext();
  const slots = useSlots();

  return (
    <span
      className={composeSlotClassName(slots?.name, className)}
      data-slot="chat-attachment-name"
      {...props}
    >
      {children ?? name}
    </span>
  );
};

export const ChatAttachmentSize = ({
  children,
  className,
  ...props
}: ChatAttachmentSizeProps) => {
  const { size } = useChatAttachmentContext();
  const slots = useSlots();
  const content = children ?? formatChatAttachmentSize(size);

  if (content == null || content === '') return null;

  return (
    <span
      className={composeSlotClassName(slots?.size, className)}
      data-slot="chat-attachment-size"
      {...props}
    >
      {content}
    </span>
  );
};

export const ChatAttachmentRemove = ({
  children,
  className,
  ...props
}: ChatAttachmentRemoveProps) => {
  const slots = useSlots();

  return (
    <CloseButton
      className={composeTwRenderProps(className, slots?.remove())}
      data-slot="chat-attachment-remove"
      {...props}
    >
      {children}
    </CloseButton>
  );
};
