'use client';

import { useContext } from 'react';
import { DropZoneContext } from './drop-zone.context';

export function useDropZonePickerContext(): { openFilePicker: () => void } {
  const { openFilePicker } = useContext(DropZoneContext);
  return { openFilePicker };
}
