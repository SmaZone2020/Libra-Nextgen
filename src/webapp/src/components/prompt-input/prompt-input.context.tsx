'use client';

import { createContext, type RefObject, useContext } from 'react';
import type {
  PromptInputVariants,
  promptInputVariants,
} from './prompt-input.styles';
import type { ChatStatus } from './prompt-input.types';

export type PromptInputContextValue = {
  allowSubmitWhileRunning: boolean;
  disabled?: boolean;
  isExpanded: boolean;
  isPending?: boolean;
  lockInputOnRun: boolean;
  maxHeight: number | string;
  onStop?: () => void;
  onSubmit?: () => void;
  setExpanded: (expanded: boolean) => void;
  setValue: (value: string) => void;
  slots?: ReturnType<typeof promptInputVariants>;
  status: ChatStatus;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  variant: PromptInputVariants['variant'];
  value: string;
};

export const PromptInputContext = createContext<PromptInputContextValue | null>(
  null
);

export const usePromptInputContext = (): PromptInputContextValue => {
  const ctx = useContext(PromptInputContext);
  if (!ctx)
    throw new Error(
      'PromptInput subcomponents must be used within PromptInput'
    );
  return ctx;
};
