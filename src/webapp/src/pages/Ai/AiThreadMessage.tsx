'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, TextArea, Tooltip } from '@heroui/react';
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
  /** 流式进行中的临时助手消息（delta 累积） */
  streamingText?: string;
  isStreaming?: boolean;
  pendingApproval?: AiToolCall | null;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  /** 编辑用户消息：messageId + 新内容。 */
  onEdit: (messageId: string, content: string) => void;
  /** 删除消息（用户消息或 AI 消息）：messageId。 */
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

  // 用户消息原地编辑态。
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isEditing) editRef.current?.focus();
  }, [isEditing]);

  // 流式进行中：工具调用逐个渲染（真实 tool_call 事件已实时到位，无需假占位）。
  // pendingApproval 去重：审批挂起时它已随 tool_call 进入 streamingTools，避免同工具渲染两次。
  const streamingTools =
    isStreaming && pendingApproval
      ? [...(toolCalls ?? []).filter((x) => x.id !== pendingApproval.id), pendingApproval]
      : null;

  const renderedToolCalls = streamingTools ?? toolCalls ?? [];

  if (message.role === 'user') {
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

  // 把文本与工具调用按 TextBefore 位置穿插成有序片段：
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

  // 流式进行中的临时工具（待审批 / 正在运行）追加到末尾。
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

        {renderBody()}

        {/* 流式进行中的工具（审批挂起 / 正在执行）穿插在末尾实时显示 */}
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
