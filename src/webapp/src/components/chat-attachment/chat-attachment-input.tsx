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
      value={{ addFiles, disabled, inputRef, multiple, openFilePicker }}
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
      if (ctx?.disabled) return;
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer?.files?.length) ctx?.addFiles(e.dataTransfer.files);
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
    >
      {children}
    </div>
  );
};
