'use client';

import type { ComponentPropsWithRef } from 'react';
import { memo, useId, useMemo } from 'react';
import type { Components as ReactMarkdownComponents } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import { marked } from 'marked';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type {
  Components as StreamdownComponents,
  StreamdownProps,
} from 'streamdown';
import { Streamdown } from 'streamdown';
import { composeSlotClassName } from '../../utils/compose';
import { CodeBlock } from '../code-block/index';
import { markdownVariants } from './markdown.styles';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const DEFAULT_STREAM_ANIMATED: StreamdownProps['animated'] = {
  animation: 'blurIn',
};

function getLanguageFromClassName(className: string | undefined): string {
  if (!className) return 'plaintext';
  const match = className.match(/language-(\w+)/);

  return match?.[1] ?? 'plaintext';
}

interface CodeComponentProps {
  children?: React.ReactNode;
  className?: string;
  node?: {
    position?: {
      start: { line: number };
      end: { line: number };
    };
  };
  [key: string]: unknown;
}

function buildMarkdownComponents(
  slots: ReturnType<typeof markdownVariants> | undefined
): Partial<ReactMarkdownComponents> {
  return {
    code: (({ children, className, node, ...props }: CodeComponentProps) => {
      const isInline =
        !node?.position?.start.line ||
        node.position.start.line === node.position.end.line;

      if (isInline) {
        return (
          <code
            className={composeSlotClassName(slots?.inlineCode, className)}
            data-slot="markdown-inline-code"
            {...(props as React.HTMLAttributes<HTMLElement>)}
          >
            {children}
          </code>
        );
      }

      const language = getLanguageFromClassName(className);
      const code = String(children ?? '').replace(/\n$/, '');

      return (
        <CodeBlock>
          <CodeBlock.Header>
            <span className="text-muted text-xs uppercase">{language}</span>
            <CodeBlock.CopyButton code={code} />
          </CodeBlock.Header>
          <CodeBlock.Code code={code} language={language} />
        </CodeBlock>
      );
    }) as ReactMarkdownComponents['code'],
    pre: function PreComponent({ children }: { children?: React.ReactNode }) {
      return <>{children}</>;
    },
  };
}

const STREAMING_COMPONENTS: StreamdownComponents = {
  code: function StreamingCodeComponent({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) {
    const language = getLanguageFromClassName(className);
    const code = String(children ?? '').replace(/\n$/, '');

    return (
      <CodeBlock>
        <CodeBlock.Header>
          <span className="text-muted text-xs uppercase">{language}</span>
          <CodeBlock.CopyButton code={code} />
        </CodeBlock.Header>
        <CodeBlock.Code code={code} language={language} />
      </CodeBlock>
    );
  } as StreamdownComponents['code'],
  inlineCode: function StreamingInlineCode({
    children,
    className,
    ...props
  }: {
    children?: React.ReactNode;
    className?: string;
    [key: string]: unknown;
  }) {
    const slots = markdownVariants();

    return (
      <code
        className={composeSlotClassName(slots?.inlineCode, className)}
        data-slot="markdown-inline-code"
        {...(props as React.HTMLAttributes<HTMLElement>)}
      >
        {children}
      </code>
    );
  } as StreamdownComponents['inlineCode'],
  pre: function PreComponent({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  } as StreamdownComponents['pre'],
};

interface MemoizedMarkdownBlockProps {
  components: Partial<ReactMarkdownComponents>;
  content: string;
  slots: ReturnType<typeof markdownVariants> | undefined;
}

const MemoizedMarkdownBlock = memo(function MemoizedMarkdownBlock({
  components,
  content,
  slots,
}: MemoizedMarkdownBlockProps) {
  return (
    <div
      className={composeSlotClassName(slots?.block, undefined)}
      data-slot="markdown-block"
    >
      <ReactMarkdown components={components} remarkPlugins={REMARK_PLUGINS}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock';

function hashString(str: string): string {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i);
  }

  return (hash >>> 0).toString(36);
}

interface TokenWithKey {
  content: string;
  key: string;
}

function buildTokensWithKeys(tokens: string[], id: string): TokenWithKey[] {
  const counts = new Map<string, number>();

  return tokens.map((content) => {
    const hash = hashString(content);
    const count = counts.get(hash) ?? 0;

    counts.set(hash, count + 1);

    return { content, key: `${id}-${hash}-${count}` };
  });
}

interface MarkdownRootProps extends ComponentPropsWithRef<'div'> {
  children: string;
  components?: Partial<ReactMarkdownComponents>;
  id?: string;
}

const MarkdownRoot = memo(function MarkdownRoot({
  children,
  className,
  components,
  id,
  ...props
}: MarkdownRootProps) {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  const slots = useMemo(() => markdownVariants(), []);
  const rawTokens = useMemo(
    () => marked.lexer(children).map((token) => token.raw),
    [children]
  );
  const tokensWithKeys = useMemo(
    () => buildTokensWithKeys(rawTokens, resolvedId),
    [resolvedId, rawTokens]
  );
  const mergedComponents = useMemo(
    () => ({ ...buildMarkdownComponents(slots), ...components }),
    [components, slots]
  );

  return (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="markdown"
      {...props}
    >
      {tokensWithKeys.map((token) => (
        <MemoizedMarkdownBlock
          key={token.key}
          components={mergedComponents}
          content={token.content}
          slots={slots}
        />
      ))}
    </div>
  );
});

interface StreamMarkdownRootProps extends ComponentPropsWithRef<'div'> {
  animated?: StreamdownProps['animated'];
  caret?: StreamdownProps['caret'];
  children: string;
  components?: StreamdownComponents;
  controls?: StreamdownProps['controls'];
  isStreaming?: boolean;
}

const StreamMarkdownRoot = memo(function StreamMarkdownRoot({
  animated = DEFAULT_STREAM_ANIMATED,
  caret = 'block',
  children,
  className,
  components,
  controls = false,
  isStreaming = false,
  ...props
}: StreamMarkdownRootProps) {
  const slots = useMemo(() => markdownVariants(), []);
  const mergedComponents = useMemo(
    () =>
      components
        ? { ...STREAMING_COMPONENTS, ...components }
        : STREAMING_COMPONENTS,
    [components]
  );

  return (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="markdown"
      {...props}
    >
      <Streamdown
        normalizeHtmlIndentation
        parseIncompleteMarkdown
        animated={animated}
        caret={isStreaming ? caret : undefined}
        components={mergedComponents}
        controls={controls}
        isAnimating={isStreaming}
        mode={isStreaming ? 'streaming' : 'static'}
        remarkPlugins={REMARK_PLUGINS}
      >
        {children}
      </Streamdown>
    </div>
  );
});

export { MarkdownRoot, StreamMarkdownRoot };
export { markdownVariants };

export type {
  MarkdownRootProps as MarkdownProps,
  MarkdownRootProps,
  StreamMarkdownRootProps as StreamMarkdownProps,
  StreamMarkdownRootProps,
};

export type { MarkdownVariants } from './markdown.styles';
