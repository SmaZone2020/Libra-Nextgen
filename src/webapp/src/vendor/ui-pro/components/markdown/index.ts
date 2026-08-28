import type { ComponentProps } from 'react';
import { MarkdownRoot, StreamMarkdownRoot } from './markdown';

export { markdownVariants } from './markdown.styles';

const Markdown = MarkdownRoot;
const StreamMarkdown = StreamMarkdownRoot;

export { Markdown, MarkdownRoot, StreamMarkdown, StreamMarkdownRoot };

export type {
  MarkdownProps,
  MarkdownRootProps,
  StreamMarkdownProps,
  StreamMarkdownRootProps,
} from './markdown';
export type { MarkdownVariants } from './markdown.styles';

export type Markdown = {
  Props: ComponentProps<typeof MarkdownRoot>;
};

export type StreamMarkdown = {
  Props: ComponentProps<typeof StreamMarkdownRoot>;
};
