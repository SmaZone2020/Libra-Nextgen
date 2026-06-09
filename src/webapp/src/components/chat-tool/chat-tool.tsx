'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import React, { createContext, useContext, useMemo } from 'react';
import { cx } from 'tailwind-variants';
import { Button, Disclosure } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { CodeBlock } from '../code-block/index';
import { CircleCheck, CircleExclamation, CircleXmark, Wrench } from '../icons';
import { TextShimmer } from '../text-shimmer/text-shimmer';
import type { ChatToolVariants } from './chat-tool.styles';
import { chatToolVariants } from './chat-tool.styles';
import type { ToolPartState } from './chat-tool.types';

type ChatToolVisualState = NonNullable<ChatToolVariants['state']>;

export function mapToolStateToVisual(
  state: ToolPartState
): ChatToolVisualState {
  switch (state) {
    case 'input-streaming':
      return 'streaming';
    case 'input-available':
      return 'running';
    case 'output-error':
      return 'error';
    case 'requires-action':
      return 'requiresAction';
    default:
      return 'complete';
  }
}

function serializeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isActiveState(state: ToolPartState): boolean {
  return state === 'input-streaming' || state === 'input-available';
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ChatToolContextValue {
  active: boolean;
  isExpandable: boolean;
  slots: ReturnType<typeof chatToolVariants>;
  state: ToolPartState;
  toolName?: string;
}

const ChatToolContext = createContext<ChatToolContextValue>({
  active: false,
  isExpandable: true,
  slots: chatToolVariants(),
  state: 'output-available',
});

const useChatToolContext = () => useContext(ChatToolContext);
const useSlots = () => {
  const { slots, state } = useChatToolContext();
  const fallback = useMemo(
    () => chatToolVariants({ state: mapToolStateToVisual(state) }),
    [state]
  );
  return slots ?? fallback;
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ChatToolRootProps extends ComponentPropsWithRef<
  typeof Disclosure
> {
  /** Controls shimmer styling for running tools. Defaults to running when the state is in progress. */
  active?: boolean;
  approveLabel?: ReactNode;
  argsText?: string;
  children?: ReactNode;
  errorText?: string;
  input?: unknown;
  /** Whether the tool row can expand to reveal body content. Defaults to true for custom children. */
  isExpandable?: boolean;
  /** Preset: called when the user approves a tool that requires action. */
  onApprove?: () => void;
  /** Preset: called when the user rejects a tool that requires action. */
  onReject?: () => void;
  output?: unknown;
  rejectLabel?: ReactNode;
  state: ToolPartState;
  toolCallId?: string;
  toolName?: string;
  /** Preset: optional label before the tool name in the default trigger. */
  triggerPrefix?: ReactNode;
}

export interface ChatToolTriggerProps extends ComponentPropsWithRef<
  typeof Disclosure.Trigger
> {
  children: ReactNode;
}

export type ChatToolStatusIconProps = {
  children?: ReactNode;
  className?: string;
};

export interface ChatToolContentProps extends ComponentPropsWithRef<
  typeof Disclosure.Content
> {
  children: ReactNode;
}

export interface ChatToolArgsProps extends ComponentPropsWithRef<'div'> {
  argsText?: string;
  children?: ReactNode;
  input?: unknown;
  label?: ReactNode;
}

export interface ChatToolResultProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
  label?: ReactNode;
  value?: unknown;
}

export interface ChatToolErrorProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
  errorText?: string;
  label?: ReactNode;
}

export interface ChatToolApprovalProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface ChatToolApprovalActionsProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export type ChatToolActionPresetProps = ComponentPropsWithRef<typeof Button> & {
  children?: ReactNode;
};

export interface ChatToolMetaProps extends ComponentPropsWithRef<'div'> {
  toolCallId: string;
}

// ─── Status icon map ──────────────────────────────────────────────────────────

const STATE_ICONS: Record<
  ToolPartState,
  React.ComponentType<{ className?: string; 'data-slot'?: string }>
> = {
  'input-available': Wrench,
  'input-streaming': Wrench,
  'output-available': CircleCheck,
  'output-error': CircleXmark,
  'requires-action': CircleExclamation,
};

// ─── Components ───────────────────────────────────────────────────────────────

export const ChatToolRoot = ({
  active,
  approveLabel,
  argsText,
  children,
  className,
  errorText,
  input,
  isExpandable,
  onApprove,
  onReject,
  output,
  rejectLabel,
  state,
  toolCallId,
  toolName,
  triggerPrefix,
  ...props
}: ChatToolRootProps) => {
  const slots = useMemo(
    () => chatToolVariants({ state: mapToolStateToVisual(state) }),
    [state]
  );

  const resolvedActive = active ?? isActiveState(state);
  const hasArgsText =
    argsText !== undefined
      ? argsText.trim() !== ''
      : input !== undefined && serializeValue(input) !== '';
  const hasOutput = output !== undefined && serializeValue(output) !== '';
  const hasError = Boolean(errorText);
  const hasApproval =
    state === 'requires-action' && Boolean(onApprove || onReject);
  const hasMeta = Boolean(toolCallId);
  const hasBodyContent = Boolean(
    hasArgsText || hasOutput || hasError || hasApproval || hasMeta
  );
  const hasTriggerContent = Boolean(
    hasBodyContent || toolName || triggerPrefix
  );
  const resolvedExpandable = isExpandable ?? (!!children || hasBodyContent);

  return (
    <ChatToolContext.Provider
      value={{
        active: resolvedActive,
        isExpandable: resolvedExpandable,
        slots,
        state,
        toolName,
      }}
    >
      <Disclosure
        className={composeTwRenderProps(className, slots?.base())}
        data-active={resolvedActive || undefined}
        data-expandable={resolvedExpandable || undefined}
        data-slot="chat-tool"
        data-state={state}
        {...props}
      >
        {children ??
          (hasTriggerContent ? (
            <>
              <ChatToolTrigger>
                <ChatToolStatusIcon />
                {triggerPrefix || toolName ? (
                  <span
                    className={composeSlotClassName(
                      slots?.triggerLabel,
                      undefined
                    )}
                  >
                    {triggerPrefix}
                    {toolName ? (
                      <span className="font-medium">{toolName}</span>
                    ) : null}
                  </span>
                ) : null}
              </ChatToolTrigger>
              {resolvedExpandable ? (
                <ChatToolContent>
                  <ChatToolArgs argsText={argsText} input={input} />
                  <ChatToolResult value={output} />
                  <ChatToolError errorText={errorText} />
                  {state === 'requires-action' && (onApprove || onReject) ? (
                    <ChatToolApproval>
                      <ChatToolApprovalActions>
                        {onReject ? (
                          <ChatToolReject onPress={onReject}>
                            {rejectLabel}
                          </ChatToolReject>
                        ) : null}
                        {onApprove ? (
                          <ChatToolApprove onPress={onApprove}>
                            {approveLabel}
                          </ChatToolApprove>
                        ) : null}
                      </ChatToolApprovalActions>
                    </ChatToolApproval>
                  ) : null}
                  {toolCallId ? <ChatToolMeta toolCallId={toolCallId} /> : null}
                </ChatToolContent>
              ) : null}
            </>
          ) : null)}
      </Disclosure>
    </ChatToolContext.Provider>
  );
};

export const ChatToolTrigger = ({
  children,
  className,
  isDisabled,
  ...props
}: ChatToolTriggerProps) => {
  const { active, isExpandable } = useChatToolContext();
  const slots = useSlots();
  const content = active ? <TextShimmer>{children}</TextShimmer> : children;
  return (
    <Disclosure.Heading>
      <Disclosure.Trigger
        className={composeTwRenderProps(
          className,
          slots?.trigger({
            className: isExpandable ? undefined : 'cursor-default',
          })
        )}
        data-expandable={isExpandable ? undefined : 'false'}
        data-slot="chat-tool-trigger"
        isDisabled={isDisabled || !isExpandable}
        {...props}
      >
        <span className={composeSlotClassName(slots?.triggerLabel, undefined)}>
          {content}
        </span>
        {isExpandable ? (
          <Disclosure.Indicator className="text-muted size-3.5 shrink-0" />
        ) : null}
      </Disclosure.Trigger>
    </Disclosure.Heading>
  );
};

export const ChatToolStatusIcon = ({
  children,
  className,
}: ChatToolStatusIconProps) => {
  const { state } = useChatToolContext();
  const slots = useSlots();
  const IconComponent = STATE_ICONS[state];

  if (children && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<{ className?: string }>,
      {
        className: cx(
          'size-3.5 shrink-0',
          className,
          (children as React.ReactElement<{ className?: string }>).props
            .className,
          state === 'output-available' && 'text-success',
          state === 'output-error' && 'text-danger',
          state === 'requires-action' && 'text-warning'
        ),
        'data-slot': 'chat-tool-status-icon',
      } as React.HTMLAttributes<HTMLElement>
    );
  }

  return (
    <span
      className={composeSlotClassName(slots?.status, className)}
      data-slot="chat-tool-status"
    >
      <IconComponent
        className={cx(
          'size-3.5 shrink-0',
          state === 'output-available' && 'text-success',
          state === 'output-error' && 'text-danger',
          state === 'requires-action' && 'text-warning'
        )}
        data-slot="chat-tool-status-icon"
      />
    </span>
  );
};

export const ChatToolContent = ({
  children,
  className,
  ...props
}: ChatToolContentProps) => {
  const { isExpandable } = useChatToolContext();
  const slots = useSlots();
  if (!isExpandable) return null;
  return (
    <Disclosure.Content
      className={composeTwRenderProps(className, slots?.content())}
      data-slot="chat-tool-content"
      {...props}
    >
      <Disclosure.Body>
        <div className={composeSlotClassName(slots?.contentBody, undefined)}>
          {children}
        </div>
      </Disclosure.Body>
    </Disclosure.Content>
  );
};

export const ChatToolArgs = ({
  argsText,
  children,
  className,
  input,
  label,
  ...props
}: ChatToolArgsProps) => {
  const slots = useSlots();
  const text = argsText ?? (input !== undefined ? serializeValue(input) : '');

  if (children) {
    return (
      <div
        className={composeSlotClassName(slots?.args, className)}
        data-slot="chat-tool-args"
        {...props}
      >
        {label ? (
          <div className={composeSlotClassName(slots?.argsLabel, undefined)}>
            {label}
          </div>
        ) : null}
        {children}
      </div>
    );
  }

  if (!text) return null;

  return (
    <div
      className={composeSlotClassName(slots?.args, className)}
      data-slot="chat-tool-args"
      {...props}
    >
      {label ? (
        <div className={composeSlotClassName(slots?.argsLabel, undefined)}>
          {label}
        </div>
      ) : null}
      <CodeBlock>
        <CodeBlock.Code code={text} language="json" />
      </CodeBlock>
    </div>
  );
};

export const ChatToolResult = ({
  children,
  className,
  label,
  value,
  ...props
}: ChatToolResultProps) => {
  const slots = useSlots();
  const { state } = useChatToolContext();

  if (state === 'output-error') return null;

  if (children) {
    return (
      <div
        className={composeSlotClassName(slots?.result, className)}
        data-slot="chat-tool-result"
        {...props}
      >
        {label ? (
          <div className={composeSlotClassName(slots?.resultLabel, undefined)}>
            {label}
          </div>
        ) : null}
        {children}
      </div>
    );
  }

  if (value === undefined) return null;

  const text = serializeValue(value);
  if (!text) return null;

  return (
    <div
      className={composeSlotClassName(slots?.result, className)}
      data-slot="chat-tool-result"
      {...props}
    >
      {label ? (
        <div className={composeSlotClassName(slots?.resultLabel, undefined)}>
          {label}
        </div>
      ) : null}
      <CodeBlock>
        <CodeBlock.Code code={text} language="json" />
      </CodeBlock>
    </div>
  );
};

export const ChatToolError = ({
  children,
  className,
  errorText,
  label,
  ...props
}: ChatToolErrorProps) => {
  const slots = useSlots();
  const { state } = useChatToolContext();

  if (state !== 'output-error' && !errorText && !children) return null;

  return (
    <div
      className={composeSlotClassName(slots?.error, className)}
      data-slot="chat-tool-error"
      {...props}
    >
      {label ? (
        <div className={composeSlotClassName(slots?.errorLabel, undefined)}>
          {label}
        </div>
      ) : null}
      {children ?? errorText}
    </div>
  );
};

export const ChatToolApproval = ({
  children,
  className,
  ...props
}: ChatToolApprovalProps) => {
  const slots = useSlots();
  const { state } = useChatToolContext();

  if (state !== 'requires-action') return null;

  return (
    <div
      className={composeSlotClassName(slots?.approval, className)}
      data-slot="chat-tool-approval"
      {...props}
    >
      {children}
    </div>
  );
};

export const ChatToolApprovalActions = ({
  children,
  className,
  ...props
}: ChatToolApprovalActionsProps) => {
  const slots = useSlots();
  return (
    <div
      className={composeSlotClassName(slots?.approvalActions, className)}
      data-slot="chat-tool-approval-actions"
      {...props}
    >
      {children}
    </div>
  );
};

export const ChatToolApprove = ({
  children,
  ...props
}: ChatToolActionPresetProps) => (
  <Button data-slot="chat-tool-approve" size="sm" variant="primary" {...props}>
    {children}
  </Button>
);

export const ChatToolReject = ({
  children,
  variant = 'secondary',
  ...props
}: ChatToolActionPresetProps) => (
  <Button data-slot="chat-tool-reject" size="sm" variant={variant} {...props}>
    {children}
  </Button>
);

export const ChatToolMeta = ({
  className,
  toolCallId,
  ...props
}: ChatToolMetaProps) => {
  const slots = useSlots();
  return (
    <div
      className={composeSlotClassName(slots?.meta, className)}
      data-slot="chat-tool-meta"
      {...props}
    >
      {toolCallId}
    </div>
  );
};
