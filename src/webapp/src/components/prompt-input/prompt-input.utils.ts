import type { ChatStatus } from './prompt-input.types';

export function resolvePromptInputStatus(
  status?: ChatStatus,
  isPending?: boolean
): ChatStatus {
  return status ?? (isPending ? 'streaming' : 'ready');
}

export function isPromptInputGenerating(status: ChatStatus): boolean {
  return status === 'submitted' || status === 'streaming';
}

/** Compact inline row height — fixed so expand detection does not depend on current layout. */
export const PROMPT_INPUT_INLINE_COMPACT_HEIGHT = 50;

export function getPromptInputSingleLineHeight(
  element: HTMLTextAreaElement
): number {
  return (
    getPromptInputLineHeight(element) + getPromptInputPaddingHeight(element)
  );
}

export function getPromptInputLineHeight(element: HTMLTextAreaElement): number {
  const style = getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) && fontSize > 0 ? 1.2 * fontSize : 20;
}

/** Content scroll height with box constraints cleared — avoids min-height skew on mobile. */
export function measurePromptInputScrollHeight(
  element: HTMLTextAreaElement
): number {
  const prevHeight = element.style.height;
  const prevMinHeight = element.style.minHeight;
  const prevMaxHeight = element.style.maxHeight;

  element.style.height = '0px';
  element.style.minHeight = '0px';
  element.style.maxHeight = 'none';

  const scrollHeight = element.scrollHeight;

  element.style.height = prevHeight;
  element.style.minHeight = prevMinHeight;
  element.style.maxHeight = prevMaxHeight;

  return scrollHeight;
}

export function resolvePromptInputTextAreaElement(
  element: HTMLTextAreaElement | null
): HTMLTextAreaElement | null {
  if (!element) return null;
  return element.tagName === 'TEXTAREA'
    ? element
    : element.querySelector('textarea');
}

/** True when the textarea content needs at least two lines (wrap or newline). */
export function isPromptInputTextAreaExpanded(
  element: HTMLTextAreaElement
): boolean {
  if (element.value.includes('\n')) return true;
  if (element.clientWidth === 0) return false;
  const scrollHeight = measurePromptInputScrollHeight(element);
  const paddingHeight = getPromptInputPaddingHeight(element);
  const lineHeight = getPromptInputLineHeight(element);
  return Math.max(0, scrollHeight - paddingHeight) > 1.5 * lineHeight;
}

function parsePixels(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function getPromptInputPaddingHeight(element: HTMLTextAreaElement): number {
  const style = getComputedStyle(element);
  return parsePixels(style.paddingTop) + parsePixels(style.paddingBottom);
}
