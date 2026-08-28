'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, Tooltip } from '@heroui/react';
import {
  ChainOfThought,
  ChatLoader,
  ChatMessage as ChatMessagePrimitive,
  ChatMessageActions,
  ChatSource,
  ChatSources,
  ChatTool,
  ChatToolGroup,
  Markdown,
  StreamMarkdown,
  TextShimmer,
} from '../../vendor/ui-pro';
import type {
  AiMessage,
  AiSource,
  AiToolCall,
} from '../../api/ai';
import type { ToolPartState } from '../../vendor/ui-pro';

export interface AiThreadMessageProps {
  message: AiMessage;
  /** 流式进行中的临时助手消息（delta 累积） */
  streamingText?: string;
  isStreaming?: boolean;
  pendingApproval?: AiToolCall | null;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onEdit: () => void;
  onFeedback: (good: boolean) => void;
  onApprove: (toolCallId: string) => void;
  onReject: (toolCallId: string) => void;
}

const ToolStateMap: Record<string, ToolPartState> = {
  running: 'input-available',
  'output-available': 'output-available',
  error: 'output-error',
  'requires-action': 'requires-action',
  'input-streaming': 'input-streaming',
};

function mapToolState(state: string): ToolPartState {
  return ToolStateMap[state] ?? 'output-available';
}

function renderSource(source: AiSource, key: string) {
  if (source.sourceType === 'url' && source.url) {
    return (
      <ChatSource
        key={key}
        description={source.description}
        href={source.url}
        sourceType="url"
        title={source.title}
      />
    );
  }
  return <ChatSource key={key} sourceType="document" title={source.title} />;
}

function renderToolCall(
  tool: AiToolCall,
  isStreaming: boolean,
  prefix: string,
  key: string,
  onApprove: (id: string) => void,
  onReject: (id: string) => void,
) {
  const state = mapToolState(tool.state);
  const needsApproval = tool.state === 'requires-action';
  const isRunning = tool.state === 'running' || tool.state === 'input-streaming';
  const hasOutput = Boolean(tool.output) && !needsApproval;

  let outputValue: unknown;
  if (hasOutput) {
    try {
      outputValue = JSON.parse(tool.output!);
    } catch {
      outputValue = tool.output;
    }
  }

  return (
    <ChatTool
      key={key}
      active={isRunning && isStreaming}
      approveLabel="Approve"
      argsText={tool.argsText}
      defaultExpanded={needsApproval || isRunning}
      errorText={tool.error}
      output={outputValue}
      rejectLabel="Reject"
      state={state}
      toolCallId={tool.id}
      toolName={tool.toolName}
      triggerPrefix={prefix}
      onApprove={needsApproval ? () => onApprove(tool.id) : undefined}
      onReject={needsApproval ? () => onReject(tool.id) : undefined}
    />
  );
}

export function AiThreadMessage({
  message,
  streamingText,
  isStreaming = false,
  pendingApproval,
  onCopy,
  onRegenerate,
  onEdit,
  onFeedback,
  onApprove,
  onReject,
}: AiThreadMessageProps) {
  const { t } = useTranslation();
  const reasoning = message.reasoning;
  const toolCalls = message.toolCalls;
  const sources = message.sources;

  // 流式进行中：工具调用逐个渲染，未完成的显示为 running。
  const streamingTools =
    isStreaming && pendingApproval
      ? [...(toolCalls ?? []), pendingApproval]
      : isStreaming && !pendingApproval
        ? [...(toolCalls ?? []), { id: 'running-tool', toolName: '…', argsText: '{}', state: 'running' } as AiToolCall]
        : null;

  const renderedToolCalls = streamingTools ?? toolCalls ?? [];

  if (message.role === 'user') {
    return (
      <ChatMessagePrimitive.User>
        <ChatMessagePrimitive.Bubble>
          <ChatMessagePrimitive.Content>
            <Markdown>{message.content}</Markdown>
          </ChatMessagePrimitive.Content>
        </ChatMessagePrimitive.Bubble>
        <ChatMessageActions>
          <ChatMessageActions.Copy
            aria-label={t('common.copy')}
            tooltip={t('common.copy')}
            onPress={() => onCopy(message.content)}
          />
          <ChatMessageActions.Edit
            aria-label={t('ai.editMessage')}
            tooltip={t('ai.editMessage')}
            onPress={onEdit}
          />
        </ChatMessageActions>
      </ChatMessagePrimitive.User>
    );
  }

  return (
    <ChatMessagePrimitive.Assistant>
      <ChatMessagePrimitive.Avatar
        alt={t('ai.assistant')}
        src="/images/icon2.jpg"
        fallback="AI"
        show
        className='object-cover select-none pointer-events-none'
      />

      <ChatMessagePrimitive.Body>
        {reasoning && reasoning.length > 0 && (
          <ChainOfThought defaultExpanded={false} isStreaming={isStreaming}>
            <ChainOfThought.Trigger>
              {isStreaming ? t('ai.thinking') : t('ai.thoughtFor', { count: reasoning.length })}
            </ChainOfThought.Trigger>
            <ChainOfThought.Content>
              <ChainOfThought.Steps>
                {reasoning.map((step, i) => (
                  <ChainOfThought.Step key={`${step.label}-${i}`} label={step.label}>
                    {step.content}
                  </ChainOfThought.Step>
                ))}
              </ChainOfThought.Steps>
            </ChainOfThought.Content>
          </ChainOfThought>
        )}

        {renderedToolCalls.length > 0 && (
          <ChatToolGroup active={isStreaming} defaultExpanded={isStreaming}>
            <ChatToolGroup.Trigger>
              {t('ai.toolCalls', { count: renderedToolCalls.length })}
            </ChatToolGroup.Trigger>
            <ChatToolGroup.Content>
              {renderedToolCalls.map((tool, index) =>
                renderToolCall(
                  tool,
                  isStreaming,
                  `${t('ai.usedTool')} `,
                  `${tool.toolName}-${index}`,
                  onApprove,
                  onReject,
                ),
              )}
            </ChatToolGroup.Content>
          </ChatToolGroup>
        )}

        {sources && sources.length > 0 && (
          <ChatSources defaultExpanded={false}>
            <ChatSources.Trigger>
              {t('ai.sources', { count: sources.length })}
            </ChatSources.Trigger>
            <ChatSources.Content>
              <ChatSources.List>
                {sources.map((source, index) =>
                  renderSource(
                    source,
                    source.sourceType === 'url'
                      ? `${source.url}-${index}`
                      : `${source.title}-${index}`,
                  ),
                )}
              </ChatSources.List>
            </ChatSources.Content>
          </ChatSources>
        )}

        {isStreaming ? (
          <>
            {streamingText ? (
              <ChatMessagePrimitive.Content>
                <StreamMarkdown isStreaming>{streamingText}</StreamMarkdown>
              </ChatMessagePrimitive.Content>
            ) : null}
            <ChatLoader.Dots />
          </>
        ) : message.content ? (
          <ChatMessagePrimitive.Content>
            <Markdown>{message.content}</Markdown>
          </ChatMessagePrimitive.Content>
        ) : null}

        {!isStreaming && (message.content || renderedToolCalls.length > 0) && (
          <ChatMessageActions>
            <ChatMessageActions.Copy
              aria-label={t('common.copy')}
              tooltip={t('common.copy')}
              onPress={() => onCopy(message.content)}
            />
            <ChatMessageActions.Regenerate
              aria-label={t('ai.regenerate')}
              tooltip={t('ai.regenerate')}
              onPress={onRegenerate}
            />
          </ChatMessageActions>
        )}
      </ChatMessagePrimitive.Body>
    </ChatMessagePrimitive.Assistant>
  );
}
