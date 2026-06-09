'use client';

import { createContext } from 'react';
import type { dropZoneVariants } from './drop-zone.styles';

export type DropZoneContextValue = {
  slots?: ReturnType<typeof dropZoneVariants>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  openFilePicker: () => void;
};

export const DropZoneContext = createContext<DropZoneContextValue>({
  inputRef: { current: null },
  openFilePicker: () => {},
});

export type DropZoneFileItemContextValue = {
  status?: 'complete' | 'failed' | 'uploading';
};

export const DropZoneFileItemContext =
  createContext<DropZoneFileItemContextValue>({});
