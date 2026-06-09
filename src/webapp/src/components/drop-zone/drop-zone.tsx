'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useCallback, useContext, useMemo, useRef } from 'react';
import { Button as ButtonPrimitive } from 'react-aria-components/Button';
import {
  DropZone as DropZonePrimitive,
  Text as TextPrimitive,
} from 'react-aria-components/DropZone';
import { AnimatePresence, domMax, LazyMotion } from 'motion/react';
import * as MotionComponents from 'motion/react-m';
import type { DOMRenderProps } from '@heroui/react';
import { dom, ProgressBar } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { CloudArrowUpIn, TrashBin } from '../icons';
import { DropZoneContext, DropZoneFileItemContext } from './drop-zone.context';
import { dropZoneVariants } from './drop-zone.styles';

// ---- GripVertical icon (inline) ----
function GripVerticalIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="9" cy="5" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="5" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="19" r="1" />
    </svg>
  );
}

// ---- Types ----

export interface DropZoneRootProps<
  E extends keyof React.JSX.IntrinsicElements = 'div',
> extends DOMRenderProps<E, undefined> {
  children: ReactNode;
  className?: string;
}

export interface DropZoneAreaProps extends ComponentPropsWithRef<
  typeof DropZonePrimitive
> {}

export interface DropZoneIconProps extends ComponentPropsWithRef<'span'> {}

export interface DropZoneLabelProps extends ComponentPropsWithRef<
  typeof TextPrimitive
> {}

export interface DropZoneDescriptionProps extends ComponentPropsWithRef<'span'> {}

export interface DropZoneInputProps extends Omit<
  ComponentPropsWithRef<'input'>,
  'onChange' | 'onSelect' | 'type'
> {
  /** Called when files are selected via the file picker. */
  onSelect?: (files: FileList) => void;
}

export interface DropZoneTriggerProps extends ComponentPropsWithRef<
  typeof ButtonPrimitive
> {}

export interface DropZoneFileListProps extends ComponentPropsWithRef<'div'> {}

export interface DropZoneFileItemProps extends ComponentPropsWithRef<
  typeof MotionComponents.div
> {
  /** Upload status of this file item. */
  status?: 'complete' | 'failed' | 'uploading';
}

export type FileFormatIconColor =
  | 'blue'
  | 'gray'
  | 'green'
  | 'orange'
  | 'purple'
  | 'red';

export interface DropZoneFileFormatIconProps extends Omit<
  React.SVGProps<SVGSVGElement>,
  'children'
> {
  /** File format label displayed on the badge (e.g. "PDF", "JPG"). */
  format?: string;
  /** Badge color. */
  color?: FileFormatIconColor;
}

export interface DropZoneFileInfoProps extends ComponentPropsWithRef<'div'> {}

export interface DropZoneFileNameProps extends ComponentPropsWithRef<'span'> {}

export interface DropZoneFileMetaProps extends ComponentPropsWithRef<'span'> {}

export interface DropZoneFileProgressProps extends ComponentPropsWithRef<
  typeof ProgressBar
> {}

export interface DropZoneFileProgressTrackProps extends ComponentPropsWithRef<
  typeof ProgressBar.Track
> {}

export interface DropZoneFileProgressFillProps extends ComponentPropsWithRef<
  typeof ProgressBar.Fill
> {}

export interface DropZoneFileRetryTriggerProps extends ComponentPropsWithRef<
  typeof ButtonPrimitive
> {}

export interface DropZoneFileRemoveTriggerProps extends ComponentPropsWithRef<
  typeof ButtonPrimitive
> {}

// ---- Components ----

export const DropZoneRoot = <
  E extends keyof React.JSX.IntrinsicElements = 'div',
>({
  children,
  className,
  ...props
}: DropZoneRootProps<E> &
  Omit<React.JSX.IntrinsicElements[E], keyof DropZoneRootProps<E>>) => {
  const slots = useMemo(() => dropZoneVariants(), []);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openFilePicker = useCallback(() => inputRef.current?.click(), []);

  return (
    <DropZoneContext.Provider value={{ inputRef, openFilePicker, slots }}>
      <dom.div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="drop-zone"
        {...(props as object)}
      >
        {children}
      </dom.div>
    </DropZoneContext.Provider>
  );
};

export const DropZoneArea = ({
  children,
  className,
  ...props
}: DropZoneAreaProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <DropZonePrimitive
      className={composeTwRenderProps(className, slots?.area())}
      data-slot="drop-zone-area"
      {...props}
    >
      {(renderProps) =>
        typeof children === 'function' ? children(renderProps) : children
      }
    </DropZonePrimitive>
  );
};

export const DropZoneIcon = ({
  children,
  className,
  ...props
}: DropZoneIconProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <span
      className={composeSlotClassName(slots?.icon, className)}
      data-slot="drop-zone-icon"
      {...props}
    >
      {children ?? <CloudArrowUpIn />}
    </span>
  );
};

export const DropZoneLabel = ({
  children,
  className,
  ...props
}: DropZoneLabelProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <TextPrimitive
      className={composeSlotClassName(slots?.label, className)}
      data-slot="drop-zone-label"
      slot="label"
      {...props}
    >
      {children}
    </TextPrimitive>
  );
};

export const DropZoneDescription = ({
  children,
  className,
  ...props
}: DropZoneDescriptionProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <span
      className={composeSlotClassName(slots?.description, className)}
      data-slot="drop-zone-description"
      {...props}
    >
      {children}
    </span>
  );
};

export const DropZoneInput = ({
  accept,
  className,
  multiple,
  onSelect,
  ...props
}: DropZoneInputProps) => {
  const { inputRef, slots } = useContext(DropZoneContext);
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) onSelect?.(files);
      e.target.value = '';
    },
    [onSelect]
  );
  return (
    <input
      ref={inputRef}
      accept={accept}
      className={composeSlotClassName(slots?.input, className)}
      data-slot="drop-zone-input"
      multiple={multiple}
      tabIndex={-1}
      type="file"
      onChange={handleChange}
      {...props}
    />
  );
};

export const DropZoneTrigger = ({
  children,
  className,
  ...props
}: DropZoneTriggerProps) => {
  const { openFilePicker, slots } = useContext(DropZoneContext);
  return (
    <ButtonPrimitive
      className={composeTwRenderProps(className, slots?.trigger())}
      data-slot="drop-zone-trigger"
      onPress={openFilePicker}
      {...props}
    >
      {(renderProps) => (
        <>{typeof children === 'function' ? children(renderProps) : children}</>
      )}
    </ButtonPrimitive>
  );
};

export const DropZoneFileList = ({
  children,
  className,
  ...props
}: DropZoneFileListProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <LazyMotion features={domMax}>
      <div
        className={composeSlotClassName(slots?.fileList, className)}
        data-slot="drop-zone-file-list"
        {...props}
      >
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </div>
    </LazyMotion>
  );
};

export const DropZoneFileItem = ({
  children,
  className,
  status,
  ...props
}: DropZoneFileItemProps) => {
  const { slots } = useContext(DropZoneContext);
  const contextValue = useMemo(() => ({ status }), [status]);
  return (
    <DropZoneFileItemContext.Provider value={contextValue}>
      <MotionComponents.div
        layout
        animate={{ opacity: 1, y: 0 }}
        className={composeSlotClassName(slots?.fileItem, className)}
        data-slot="drop-zone-file-item"
        data-status={status}
        exit={{ opacity: 0, transition: { duration: 0.2 } }}
        initial={{ opacity: 0, y: -8 }}
        transition={{ layout: { bounce: 0.15, duration: 0.4, type: 'spring' } }}
        {...props}
      >
        {children}
      </MotionComponents.div>
    </DropZoneFileItemContext.Provider>
  );
};

export const DropZoneFileFormatIcon = ({
  className,
  color = 'gray',
  format,
  ...props
}: DropZoneFileFormatIconProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <svg
      aria-hidden="true"
      className={composeSlotClassName(slots?.fileFormatIcon, className)}
      data-slot="drop-zone-file-format-icon"
      fill="none"
      height="40"
      viewBox="0 0 32 40"
      width="32"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M24 39.25H8C5.10051 39.25 2.75 36.8995 2.75 34V6C2.75 3.10051 5.10051 0.75 8 0.75H17.5147C18.9071 0.75 20.2425 1.30312 21.227 2.28769L29.7123 10.773C30.6969 11.7575 31.25 13.0929 31.25 14.4853V34C31.25 36.8995 28.8995 39.25 24 39.25Z"
        fill="var(--color-surface)"
        stroke="var(--color-border)"
        strokeWidth="1.5"
      />
      <path
        d="M19 1V8C19 10.2091 20.7909 12 23 12H31"
        fill="none"
        stroke="var(--color-border)"
        strokeWidth="1.5"
      />
      {!!format && (
        <foreignObject height="40" width="32" x="0" y="0">
          <div
            className={slots?.fileFormatIconBadge()}
            data-color={color}
            data-slot="drop-zone-file-format-icon-badge"
          >
            {format}
          </div>
        </foreignObject>
      )}
    </svg>
  );
};

export const DropZoneFileInfo = ({
  children,
  className,
  ...props
}: DropZoneFileInfoProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <div
      className={composeSlotClassName(slots?.fileInfo, className)}
      data-slot="drop-zone-file-info"
      {...props}
    >
      {children}
    </div>
  );
};

export const DropZoneFileName = ({
  children,
  className,
  ...props
}: DropZoneFileNameProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <span
      className={composeSlotClassName(slots?.fileName, className)}
      data-slot="drop-zone-file-name"
      {...props}
    >
      {children}
    </span>
  );
};

export const DropZoneFileMeta = ({
  children,
  className,
  ...props
}: DropZoneFileMetaProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <span
      className={composeSlotClassName(slots?.fileMeta, className)}
      data-slot="drop-zone-file-meta"
      {...props}
    >
      {children}
    </span>
  );
};

export const DropZoneFileProgress = ({
  children,
  className,
  size = 'sm',
  ...props
}: DropZoneFileProgressProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <ProgressBar
      aria-label={props['aria-label'] ?? 'Upload progress'}
      className={composeTwRenderProps(className, slots?.fileProgress())}
      data-slot="drop-zone-file-progress"
      size={size}
      {...props}
    >
      {children}
    </ProgressBar>
  );
};

export const DropZoneFileProgressTrack = ({
  children,
  className,
  ...props
}: DropZoneFileProgressTrackProps) => (
  <ProgressBar.Track
    className={className}
    data-slot="drop-zone-file-progress-track"
    {...props}
  >
    {children}
  </ProgressBar.Track>
);

export const DropZoneFileProgressFill = ({
  className,
  ...props
}: DropZoneFileProgressFillProps) => (
  <ProgressBar.Fill
    className={className}
    data-slot="drop-zone-file-progress-fill"
    {...props}
  />
);

export const DropZoneFileRetryTrigger = ({
  children,
  className,
  ...props
}: DropZoneFileRetryTriggerProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <ButtonPrimitive
      className={composeTwRenderProps(className, slots?.fileRetryTrigger())}
      data-slot="drop-zone-file-retry-trigger"
      {...props}
    >
      {(renderProps) => (
        <>
          {typeof children === 'function'
            ? children(renderProps)
            : (children ?? 'Try again')}
        </>
      )}
    </ButtonPrimitive>
  );
};

export const DropZoneFileRemoveTrigger = ({
  children,
  className,
  ...props
}: DropZoneFileRemoveTriggerProps) => {
  const { slots } = useContext(DropZoneContext);
  return (
    <ButtonPrimitive
      className={composeTwRenderProps(className, slots?.fileRemoveTrigger())}
      data-slot="drop-zone-file-remove-trigger"
      {...props}
    >
      {(renderProps) => (
        <>
          {typeof children === 'function'
            ? children(renderProps)
            : (children ?? <TrashBin />)}
        </>
      )}
    </ButtonPrimitive>
  );
};
