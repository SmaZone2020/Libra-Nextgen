'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

interface ChatAttachmentInputContextValue {
  accept?: string;
  addFiles: (files: ArrayLike<File>) => void;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  multiple: boolean;
  openFilePicker: () => void;
}

const ChatAttachmentInputContext =
  createContext<ChatAttachmentInputContextValue | null>(null);

function mergeHandlers<T>(
  a: ((e: T) => void) | undefined,
  b: ((e: T) => void) | undefined
): ((e: T) => void) | undefined {
  if (a && b)
    return (e) => {
      a(e);
      b(e);
    };
  return b ?? a;
}

function hasDragFiles(e: React.DragEvent): boolean {
  return e.dataTransfer?.types?.includes('Files') ?? false;
}

function matchesAccept(file: File, accept: string): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .some((part) => {
      if (part.endsWith('/*')) return type.startsWith(part.slice(0, -1));
      if (part.startsWith('.')) return name.endsWith(part);
      return type === part;
    });
}

function extensionFromImageType(type: string): string {
  switch (type) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/png':
    default:
      return 'png';
  }
}

function ensurePastedImageName(file: File, index: number): File {
  if (file.name || typeof File === 'undefined') return file;
  const type = file.type || 'image/png';
  return new File(
    [file],
    `pasted-image-${index + 1}.${extensionFromImageType(type)}`,
    {
      lastModified: file.lastModified || Date.now(),
      type,
    }
  );
}

function getClipboardImageFiles(e: React.ClipboardEvent): File[] {
  const data = e.clipboardData;
  if (!data) return [];

  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }

  if (!files.length) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith('image/')) files.push(file);
    }
  }

  return files.map(ensurePastedImageName);
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type ChatAttachmentInputProps = {
  accept?: string;
  children: ReactNode;
  disabled?: boolean;
  multiple?: boolean;
  onFilesSelected: (files: File[]) => void;
};

export type ChatAttachmentInputTriggerRenderProps = {
  'aria-label'?: string;
  className?: string;
  disabled?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
  type: 'button' | 'reset' | 'submit';
};

export type ChatAttachmentInputTriggerProps =
  ComponentPropsWithoutRef<'button'> & {
    render?: (props: ChatAttachmentInputTriggerRenderProps) => ReactNode;
  };

export type ChatAttachmentInputDropzoneRenderProps =
  ComponentPropsWithoutRef<'div'> & {
    'data-dragging'?: true;
  };

export type ChatAttachmentInputDropzoneProps =
  ComponentPropsWithoutRef<'div'> & {
    render?: (props: ChatAttachmentInputDropzoneRenderProps) => ReactNode;
  };

// ─── Components ───────────────────────────────────────────────────────────────

export const ChatAttachmentInputRoot = ({
  accept,
  children,
  disabled = false,
  multiple = true,
  onFilesSelected,
}: ChatAttachmentInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const addFiles = useCallback(
    (files: ArrayLike<File>) => {
      if (disabled) return;
      const arr = Array.from(files);
      if (arr.length) onFilesSelected(multiple ? arr : arr.slice(0, 1));
    },
    [disabled, multiple, onFilesSelected]
  );

  return (
    <ChatAttachmentInputContext.Provider
      value={{ accept, addFiles, disabled, inputRef, multiple, openFilePicker }}
    >
      <input
        ref={inputRef}
        aria-hidden
        accept={accept}
        className="hidden"
        disabled={disabled}
        multiple={multiple}
        type="file"
        onChange={(e) => {
          if (e.target.files?.length) {
            addFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />
      {children}
    </ChatAttachmentInputContext.Provider>
  );
};

export const ChatAttachmentInputTrigger = ({
  children,
  className,
  onClick,
  render,
  ...props
}: ChatAttachmentInputTriggerProps) => {
  const ctx = useContext(ChatAttachmentInputContext);
  const handlePress = () => {
    if (!ctx?.disabled) ctx?.openFilePicker();
  };

  if (render) {
    return render({
      'aria-label': props['aria-label'],
      className,
      disabled: ctx?.disabled || props.disabled,
      isDisabled: ctx?.disabled || props.disabled,
      onPress: handlePress,
      type: (props.type as 'button' | 'reset' | 'submit') ?? 'button',
    }) as React.JSX.Element;
  }

  return (
    <button
      className={className}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handlePress();
        onClick?.(e);
      }}
      {...props}
    >
      {children}
    </button>
  );
};

export const ChatAttachmentInputDropzone = ({
  children,
  className,
  onDragEnterCapture,
  onDragLeaveCapture,
  onDragOverCapture,
  onDropCapture,
  onPasteCapture,
  render,
  ...props
}: ChatAttachmentInputDropzoneProps) => {
  const ctx = useContext(ChatAttachmentInputContext);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!ctx?.disabled && hasDragFiles(e)) {
        e.preventDefault();
        setIsDragging(true);
      }
    },
    [ctx?.disabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!ctx?.disabled && hasDragFiles(e)) {
        e.preventDefault();
        setIsDragging(true);
      }
    },
    [ctx?.disabled]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (ctx?.disabled) return;
      e.preventDefault();
      const related = e.relatedTarget as Node | null;
      if (related && e.currentTarget.contains(related)) return;
      setIsDragging(false);
    },
    [ctx?.disabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!ctx || ctx.disabled) return;
      e.preventDefault();
      setIsDragging(false);
      if (!e.dataTransfer?.files?.length) return;
      let files = Array.from(e.dataTransfer.files);
      if (ctx.accept) {
        files = files.filter((file) => matchesAccept(file, ctx.accept!));
      }
      if (files.length) ctx.addFiles(files);
    },
    [ctx]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (!ctx || ctx.disabled) return;
      let files = getClipboardImageFiles(e);
      if (!files.length) return;
      if (ctx.accept) {
        files = files.filter((file) => matchesAccept(file, ctx.accept!));
      }
      if (!files.length) return;
      e.preventDefault();
      ctx.addFiles(files);
    },
    [ctx]
  );

  const draggingProp = isDragging ? ({ 'data-dragging': true } as const) : null;

  if (render) {
    return render({
      ...props,
      ...draggingProp,
      className,
      onDragEnterCapture: mergeHandlers(onDragEnterCapture, handleDragEnter),
      onDragLeaveCapture: mergeHandlers(onDragLeaveCapture, handleDragLeave),
      onDragOverCapture: mergeHandlers(onDragOverCapture, handleDragOver),
      onDropCapture: mergeHandlers(onDropCapture, handleDrop),
      onPasteCapture: mergeHandlers(onPasteCapture, handlePaste),
    }) as React.JSX.Element;
  }

  return (
    <div
      className={className}
      {...draggingProp}
      {...props}
      onDragEnterCapture={mergeHandlers(onDragEnterCapture, handleDragEnter)}
      onDragLeaveCapture={mergeHandlers(onDragLeaveCapture, handleDragLeave)}
      onDragOverCapture={mergeHandlers(onDragOverCapture, handleDragOver)}
      onDropCapture={mergeHandlers(onDropCapture, handleDrop)}
      onPasteCapture={mergeHandlers(onPasteCapture, handlePaste)}
    >
      {children}
    </div>
  );
};
