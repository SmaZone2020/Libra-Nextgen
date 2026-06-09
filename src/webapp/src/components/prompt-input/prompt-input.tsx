'use client';

import {
  type ComponentPropsWithRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import type { PressEvent } from 'react-aria-components';
import { Button, Spinner, TextArea, Tooltip } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { ArrowUp, Xmark } from '../icons';
import type { PromptInputContextValue } from './prompt-input.context';
import {
  PromptInputContext,
  usePromptInputContext,
} from './prompt-input.context';
import type { PromptInputVariants } from './prompt-input.styles';
import { promptInputVariants } from './prompt-input.styles';
import type { ChatStatus } from './prompt-input.types';
import {
  getPromptInputSingleLineHeight,
  isPromptInputGenerating,
  isPromptInputTextAreaExpanded,
  PROMPT_INPUT_INLINE_COMPACT_HEIGHT,
  resolvePromptInputStatus,
  resolvePromptInputTextAreaElement,
} from './prompt-input.utils';

export interface PromptInputRootProps extends ComponentPropsWithRef<'div'> {
  allowSubmitWhileRunning?: boolean;
  children: ReactNode;
  isDisabled?: boolean;
  /** @deprecated Prefer `status`. */
  isPending?: boolean;
  lockInputOnRun?: boolean;
  maxHeight?: number | string;
  onStop?: () => void;
  onSubmit?: () => void;
  onValueChange?: (value: string) => void;
  size?: PromptInputVariants['size'];
  status?: ChatStatus;
  /** @default "primary" */
  variant?: PromptInputVariants['variant'];
  value?: string;
}

export const PromptInputRoot = ({
  allowSubmitWhileRunning = false,
  children,
  className,
  isDisabled: disabled = false,
  isPending = false,
  lockInputOnRun = true,
  maxHeight = 240,
  onStop,
  onSubmit,
  onValueChange,
  size = 'md',
  status: statusProp,
  value: valueProp,
  variant = 'primary',
  ...props
}: PromptInputRootProps) => {
  const [internalValue, setInternalValue] = useState<string>(valueProp ?? '');
  const [isExpanded, setIsExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const slots = useMemo(
    () => promptInputVariants({ size, variant }),
    [size, variant]
  );

  const setExpanded = useCallback((val: boolean) => {
    setIsExpanded((prev) => (prev === val ? prev : val));
  }, []);

  useLayoutEffect(() => {
    if (variant !== 'inline') setIsExpanded(false);
  }, [variant]);

  const value = valueProp ?? internalValue;
  const status = resolvePromptInputStatus(statusProp, isPending);
  const isPendingOrStreaming = isPromptInputGenerating(status);

  const setValue = useCallback(
    (val: string) => {
      if (valueProp === undefined) setInternalValue(val);
      onValueChange?.(val);
    },
    [onValueChange, valueProp]
  );

  const contextValue: PromptInputContextValue = useMemo(
    () => ({
      allowSubmitWhileRunning,
      disabled,
      isExpanded,
      isPending,
      lockInputOnRun,
      maxHeight,
      onStop,
      onSubmit,
      setExpanded,
      setValue,
      slots,
      status,
      textareaRef,
      variant,
      value,
    }),
    [
      allowSubmitWhileRunning,
      disabled,
      isExpanded,
      isPending,
      lockInputOnRun,
      maxHeight,
      onStop,
      onSubmit,
      status,
      setExpanded,
      setValue,
      slots,
      variant,
      value,
    ]
  );

  return jsx(PromptInputContext, {
    value: contextValue,
    children: jsx('div', {
      className: composeSlotClassName(slots?.base, className),
      'data-disabled': disabled || undefined,
      'data-pending': isPendingOrStreaming || undefined,
      'data-slot': 'prompt-input',
      'data-status': status,
      'data-expanded': variant === 'inline' && isExpanded ? true : undefined,
      'data-variant': variant,
      ...props,
      children,
    }),
  });
};

export interface PromptInputShellProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const PromptInputShell = ({
  children,
  className,
  ...props
}: PromptInputShellProps) => {
  const { disabled, slots, textareaRef } = usePromptInputContext();
  return jsx('div', {
    className: composeSlotClassName(slots?.shell, className),
    'data-slot': 'prompt-input-shell',
    onClick: (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      const target = e.target as Element;
      if (
        target.closest(
          'button, a, input, select, textarea, [role="button"], [data-slot="prompt-input-toolbar"], [data-slot="prompt-input-queue"], [data-slot="chat-attachment-remove"]'
        )
      )
        return;
      textareaRef.current?.focus();
    },
    ...props,
    children,
  });
};

export interface PromptInputContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const PromptInputContent = ({
  children,
  className,
  ...props
}: PromptInputContentProps) => {
  const { slots } = usePromptInputContext();
  return jsx('div', {
    className: composeSlotClassName(slots?.content, className),
    'data-slot': 'prompt-input-content',
    ...props,
    children,
  });
};

export interface PromptInputAttachmentsProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const PromptInputAttachments = ({
  children,
  className,
  ...props
}: PromptInputAttachmentsProps) => {
  const { slots } = usePromptInputContext();
  return jsx('div', {
    className: composeSlotClassName(slots?.attachments, className),
    'data-slot': 'prompt-input-attachments',
    ...props,
    children,
  });
};

export interface PromptInputTextAreaProps extends ComponentPropsWithRef<
  typeof TextArea
> {
  disableAutosize?: boolean;
}

export const PromptInputTextArea = ({
  className,
  disableAutosize = false,
  onKeyDown,
  ...props
}: PromptInputTextAreaProps) => {
  const {
    allowSubmitWhileRunning,
    disabled,
    isExpanded,
    lockInputOnRun,
    maxHeight,
    onSubmit,
    setExpanded,
    setValue,
    slots,
    status,
    textareaRef,
    value,
    variant,
  } = usePromptInputContext();

  const isGenerating = isPromptInputGenerating(status);

  const autosize = useCallback(
    (el: HTMLTextAreaElement | null | EventTarget) => {
      const area = resolvePromptInputTextAreaElement(
        el as HTMLTextAreaElement | null
      );
      if (!area || disableAutosize) return;

      const text = area.value;

      if (variant === 'inline') {
        const hasAttachments = Boolean(
          area
            .closest('[data-slot="prompt-input-shell"]')
            ?.querySelector('[data-slot="prompt-input-attachments"] > *')
        );
        const wantsExpand =
          hasAttachments ||
          (text.trim().length > 0 && isPromptInputTextAreaExpanded(area));
        if (wantsExpand && !isExpanded) {
          setExpanded(true);
          return;
        }
        if (!text.trim() && !hasAttachments && isExpanded) {
          setExpanded(false);
          return;
        }
        if (!isExpanded && !hasAttachments) {
          const height = Math.max(
            PROMPT_INPUT_INLINE_COMPACT_HEIGHT,
            getPromptInputSingleLineHeight(area)
          );
          area.style.height = `${height}px`;
          return;
        }
      }

      area.style.height = 'auto';
      area.style.height =
        typeof maxHeight === 'number'
          ? `${Math.min(area.scrollHeight, maxHeight)}px`
          : `min(${area.scrollHeight}px, ${maxHeight})`;
    },
    [disableAutosize, isExpanded, maxHeight, setExpanded, variant]
  );

  useLayoutEffect(() => {
    autosize(textareaRef.current);
  }, [autosize, textareaRef, value]);

  return jsx(TextArea, {
    ref: textareaRef,
    fullWidth: true,
    'aria-label':
      ((props as Record<string, unknown>)['aria-label'] as
        | string
        | undefined) ?? 'Message input',
    className: composeTwRenderProps(className, slots?.textarea()),
    'data-slot': 'prompt-input-textarea',
    disabled: disabled || (lockInputOnRun && isGenerating),
    placeholder:
      ((props as Record<string, unknown>).placeholder as string | undefined) ??
      'What do you want to know?',
    rows: 1,
    value,
    onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (isGenerating && !allowSubmitWhileRunning) return;
        onSubmit?.();
      }
      onKeyDown?.(e);
    },
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      autosize(e.target);
    },
    ...props,
  });
};

export interface PromptInputToolbarProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const PromptInputToolbar = ({
  children,
  className,
  ...props
}: PromptInputToolbarProps) => {
  const { slots } = usePromptInputContext();
  return jsx('div', {
    className: composeSlotClassName(slots?.toolbar, className),
    'data-slot': 'prompt-input-toolbar',
    ...props,
    children,
  });
};

export interface PromptInputToolbarStartProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const PromptInputToolbarStart = ({
  children,
  className,
  ...props
}: PromptInputToolbarStartProps) => {
  const { slots } = usePromptInputContext();
  return jsx('div', {
    className: composeSlotClassName(slots?.toolbarStart, className),
    'data-slot': 'prompt-input-toolbar-start',
    ...props,
    children,
  });
};

export interface PromptInputToolbarEndProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const PromptInputToolbarEnd = ({
  children,
  className,
  ...props
}: PromptInputToolbarEndProps) => {
  const { slots } = usePromptInputContext();
  return jsx('div', {
    className: composeSlotClassName(slots?.toolbarEnd, className),
    'data-slot': 'prompt-input-toolbar-end',
    ...props,
    children,
  });
};

export interface PromptInputFooterProps extends ComponentPropsWithRef<'p'> {
  children: ReactNode;
}

export const PromptInputFooter = ({
  children,
  className,
  ...props
}: PromptInputFooterProps) => {
  const { slots } = usePromptInputContext();
  return jsx('p', {
    className: composeSlotClassName(slots?.footer, className),
    'data-slot': 'prompt-input-footer',
    ...props,
    children,
  });
};

function SendIcon({ status }: { status: ChatStatus }) {
  if (status === 'submitted')
    return jsx(Spinner, { color: 'current', size: 'sm' });
  if (status === 'streaming')
    return jsx('span', {
      'aria-hidden': true,
      className: 'rounded-xs size-3 bg-current',
    });
  return jsx(status === 'error' ? Xmark : ArrowUp, { className: 'size-4' });
}

export interface PromptInputSendProps extends ComponentPropsWithRef<
  typeof Button
> {
  children?: ReactNode;
  onStop?: () => void;
  status?: ChatStatus;
}

export const PromptInputSend = ({
  children,
  className,
  isDisabled: isDisabledProp,
  onPress,
  onStop: onStopProp,
  status: statusProp,
  ...props
}: PromptInputSendProps) => {
  const {
    allowSubmitWhileRunning,
    disabled,
    onStop: ctxOnStop,
    onSubmit,
    slots,
    status: ctxStatus,
    value,
    variant,
  } = usePromptInputContext();

  const status = statusProp ?? ctxStatus;
  const onStop = onStopProp ?? ctxOnStop;
  const isGenerating = isPromptInputGenerating(status);

  const canSubmitWhileRunning =
    allowSubmitWhileRunning &&
    isGenerating &&
    (isDisabledProp === false ||
      (isDisabledProp === undefined && Boolean(value.trim())));
  const canStop = isGenerating && Boolean(onStop) && !canSubmitWhileRunning;

  const isDisabled =
    isDisabledProp ??
    (disabled ||
      (isGenerating &&
        !canStop &&
        !(allowSubmitWhileRunning && value.trim())) ||
      (!isGenerating && !value.trim()));

  const displayStatus = canSubmitWhileRunning ? 'ready' : status;

  return jsx(Button, {
    ...props,
    isIconOnly: true,
    'aria-label':
      ((props as Record<string, unknown>)['aria-label'] as
        | string
        | undefined) ?? (canStop ? 'Stop' : 'Send message'),
    className: composeTwRenderProps(className, slots?.send()),
    'data-slot': 'prompt-input-send',
    'data-status': status,
    isDisabled,
    size: variant === 'inline' ? 'sm' : 'md',
    onPress: (e: PressEvent) => {
      if (canStop) {
        onStop?.();
        onPress?.(e);
        return;
      }
      onPress?.(e);
      onSubmit?.();
    },
    children: children ?? jsx(SendIcon, { status: displayStatus }),
  });
};

export interface PromptInputActionProps extends ComponentPropsWithRef<
  typeof Button
> {
  children: ReactNode;
  tooltip?: ReactNode;
}

export const PromptInputAction = ({
  children,
  className,
  tooltip,
  variant: variantProp,
  ...props
}: PromptInputActionProps) => {
  const { disabled, lockInputOnRun, status, variant } = usePromptInputContext();
  const isGenerating = isPromptInputGenerating(status);
  const resolvedVariant = variantProp ?? 'tertiary';

  const button = jsx(Button, {
    ...props,
    isIconOnly: true,
    className,
    'data-slot': 'prompt-input-action',
    isDisabled:
      disabled ||
      (props.isDisabled as boolean | undefined) ||
      (lockInputOnRun && isGenerating),
    size: variant === 'inline' ? 'sm' : 'md',
    variant: resolvedVariant,
    children,
  });

  if (tooltip) {
    return jsxs(Tooltip, {
      delay: 0,
      children: [
        jsx(Tooltip.Trigger, { children: button }),
        jsx(Tooltip.Content, { children: tooltip }),
      ],
    });
  }

  return button;
};

export type { PromptInputRootProps as PromptInputProps };
