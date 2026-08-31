'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, TextArea, Tooltip } from '@heroui/react';
import { AntennaSignal } from '@gravity-ui/icons';
import {
  ChainOfThought,
  ChatLoader,
  ChatMessage as ChatMessagePrimitive,
  ChatMessageActions,
  ChatSource,
  ChatSources,
  ChatTool,
  Markdown,
  StreamMarkdown,
  TextShimmer,
} from '../../vendor/ui-pro';
import { TrashBin } from '../../vendor/ui-pro/components/icons';
import type {
  AiMessage,
  AiSource,
  AiToolCall,
} from '../../api/ai';
import type { ToolPartState } from '../../vendor/ui-pro';

export interface AiThreadMessageProps {
  message: AiMessage;
  streamingText?: string;
  isStreaming?: boolean;
  pendingApproval?: AiToolCall | null;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onEdit: (messageId: string, content: string) => void;
  onDelete: (messageId: string) => void;
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

interface SystemEventPayload {
  type: 'system_event';
  event?: string;
  agentId?: string;
  hostname?: string;
  ip?: string;
  message?: string;
}

function parseSystemEvent(content: string): SystemEventPayload | null {
  if (!content || !content.startsWith('{')) return null;
  try {
    const obj = JSON.parse(content);
    return obj && typeof obj === 'object' && !Array.isArray(obj) && obj.type === 'system_event'
      ? (obj as SystemEventPayload)
      : null;
  } catch {
    return null;
  }
}

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
  onDelete,
  onFeedback,
  onApprove,
  onReject,
}: AiThreadMessageProps) {
  const { t } = useTranslation();
  const reasoning = message.reasoning;
  const toolCalls = message.toolCalls;
  const sources = message.sources;

  const mergedReasoning = useMemo(() => {
    if (!reasoning || reasoning.length === 0) return reasoning;
    const out: { label: string; content: string }[] = [];
    for (const step of reasoning) {
      const prev = out[out.length - 1];
      if (prev && prev.label === step.label) prev.content += step.content;
      else out.push({ label: step.label, content: step.content });
    }
    return out;
  }, [reasoning]);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isEditing) editRef.current?.focus();
  }, [isEditing]);

  const streamingTools =
    isStreaming && pendingApproval
      ? [...(toolCalls ?? []).filter((x) => x.id !== pendingApproval.id), pendingApproval]
      : null;

  const renderedToolCalls = streamingTools ?? toolCalls ?? [];

  if (message.role === 'user') {
    const sysEvent = parseSystemEvent(message.content);
    if (sysEvent) {
      const isOnline = sysEvent.event === 'agent.online';
      return (
        <div className="flex justify-center py-1">
          <div className="flex w-full md:max-w-[80%] items-start gap-3 rounded-2xl border border-default-200 bg-default/40 px-4 py-3 dark:border-default-800">
            <AntennaSignal
              className={`mt-0.5 size-4 shrink-0 ${isOnline ? 'text-success' : 'text-danger'}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-medium text-default-700">{t('ai.systemEvent')}</span>
                <Chip size="sm" variant="soft" color={isOnline ? 'success' : 'danger'}>
                  {isOnline ? t('ai.eventOnline') : t('ai.eventOffline')}
                </Chip>
              </div>
              {sysEvent.message && (
                <p className="mt-1 text-sm text-default-700">{sysEvent.message}</p>
              )}
            </div>
          </div>
        </div>
      );
    }
    return (
      <ChatMessagePrimitive.User>
        <ChatMessagePrimitive.Bubble>
          <ChatMessagePrimitive.Content>
            {isEditing ? (
              <div className="flex flex-col gap-2">
                <TextArea
                  ref={editRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label={t('ai.editMessage')}
                  autoFocus
                  rows={2}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      setIsEditing(false);
                      setDraft('');
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    isDisabled={!draft.trim()}
                    onPress={() => {
                      const next = draft.trim();
                      if (next) onEdit(message.id, next);
                      setIsEditing(false);
                    }}
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            ) : (
              <Markdown>{message.content}</Markdown>
            )}
          </ChatMessagePrimitive.Content>
        </ChatMessagePrimitive.Bubble>
        {!isEditing && (
          <ChatMessageActions>
            <ChatMessageActions.Copy
              aria-label={t('common.copy')}
              tooltip={t('common.copy')}
              onPress={() => onCopy(message.content)}
            />
            <ChatMessageActions.Edit
              aria-label={t('ai.editMessage')}
              tooltip={t('ai.editMessage')}
              onPress={() => {
                setDraft(message.content);
                setIsEditing(true);
              }}
            />
            <ChatMessagePrimitive.Action
              aria-label={t('ai.deleteMessage')}
              tooltip={t('ai.deleteMessage')}
              onPress={() => onDelete(message.id)}
            >
              <TrashBin className="size-4" />
            </ChatMessagePrimitive.Action>
          </ChatMessageActions>
        )}
      </ChatMessagePrimitive.User>
    );
  }

  // [ {type:'text', text}, {type:'tool', tool}, {type:'text', text}, ... ]
  const interleaved = useMemo(() => {
    const tools = [...(toolCalls ?? [])].sort((a, b) =>
      (a.textBefore ?? '').length - (b.textBefore ?? '').length,
    );
    const segments: { type: 'text' | 'tool'; text?: string; tool?: AiToolCall }[] = [];
    let cursor = 0;
    for (const tool of tools) {
      const before = tool.textBefore ?? '';
      if (before.length > cursor) {
        segments.push({ type: 'text', text: message.content.slice(cursor, before.length) });
        cursor = before.length;
      }
      segments.push({ type: 'tool', tool });
    }
    if (cursor < message.content.length) {
      segments.push({ type: 'text', text: message.content.slice(cursor) });
    }
    return segments;
  }, [message.content, toolCalls]);

  const tailTools = streamingTools ?? [];
  const hasTailTools = tailTools.length > 0;

  const renderBody = () => {
    const parts: React.ReactNode[] = [];
    let key = 0;
    for (const seg of interleaved) {
      if (seg.type === 'text' && seg.text) {
        parts.push(
          <ChatMessagePrimitive.Content key={`text-${key++}`}>
            <Markdown>{seg.text}</Markdown>
          </ChatMessagePrimitive.Content>,
        );
      } else if (seg.type === 'tool' && seg.tool) {
        parts.push(
          renderToolCall(
            seg.tool,
            isStreaming,
            `${t('ai.usedTool')} `,
            `tool-${key++}`,
            onApprove,
            onReject,
          ),
        );
      }
    }
    return parts;
  };

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
        {mergedReasoning && mergedReasoning.length > 0 && (
          <ChainOfThought defaultExpanded={false} isStreaming={isStreaming}>
            <ChainOfThought.Trigger>
              {isStreaming ? t('ai.thinking') : t('ai.thoughtFor', { count: mergedReasoning.length })}
            </ChainOfThought.Trigger>
            <ChainOfThought.Content>
              <ChainOfThought.Steps>
                {mergedReasoning.map((step, i) => (
                  <ChainOfThought.Step key={`${step.label}-${i}`} label={step.label}>
                    {step.content}
                  </ChainOfThought.Step>
                ))}
              </ChainOfThought.Steps>
            </ChainOfThought.Content>
          </ChainOfThought>
        )}

        {renderBody()}

        {hasTailTools && (
          <div className="flex flex-col gap-2">
            {tailTools.map((tool, index) =>
              renderToolCall(
                tool,
                isStreaming,
                `${t('ai.usedTool')} `,
                `tail-tool-${index}`,
                onApprove,
                onReject,
              ),
            )}
          </div>
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
            <ChatMessagePrimitive.Action
              aria-label={t('ai.deleteMessage')}
              tooltip={t('ai.deleteMessage')}
              onPress={() => onDelete(message.id)}
            >
              <TrashBin className="size-4" />
            </ChatMessagePrimitive.Action>
          </ChatMessageActions>
        )}
      </ChatMessagePrimitive.Body>
    </ChatMessagePrimitive.Assistant>
  );
}
