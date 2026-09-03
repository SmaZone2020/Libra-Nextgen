'use client';

import { createContext, useContext } from 'react';
import type { DragControls } from 'motion/react';

type PromptInputQueueListContextValue = {
  reorderEnabled: boolean;
};

type PromptInputQueueItemContextValue = {
  dragControls?: DragControls;
};

export const PromptInputQueueListContext =
  createContext<PromptInputQueueListContextValue>({
    reorderEnabled: false,
  });

export const PromptInputQueueItemContext =
  createContext<PromptInputQueueItemContextValue>({});

export const usePromptInputQueueListContext =
  (): PromptInputQueueListContextValue =>
    useContext(PromptInputQueueListContext);

export const usePromptInputQueueItemContext =
  (): PromptInputQueueItemContextValue =>
    useContext(PromptInputQueueItemContext);
