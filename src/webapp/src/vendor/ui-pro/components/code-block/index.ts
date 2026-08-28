import type { ComponentProps } from 'react';
import {
  CodeBlockCode,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockRoot,
} from './code-block';

export const CodeBlock = Object.assign(CodeBlockRoot, {
  Code: CodeBlockCode,
  CopyButton: CodeBlockCopyButton,
  Header: CodeBlockHeader,
  Root: CodeBlockRoot,
});

export type CodeBlock = {
  CodeProps: ComponentProps<typeof CodeBlockCode>;
  CopyButtonProps: ComponentProps<typeof CodeBlockCopyButton>;
  HeaderProps: ComponentProps<typeof CodeBlockHeader>;
  Props: ComponentProps<typeof CodeBlockRoot>;
  RootProps: ComponentProps<typeof CodeBlockRoot>;
};

export { CodeBlockCode, CodeBlockCopyButton, CodeBlockHeader, CodeBlockRoot };
export type {
  CodeBlockCodeProps,
  CodeBlockCopyButtonProps,
  CodeBlockHeaderProps,
  CodeBlockProps,
  CodeBlockRootProps,
} from './code-block';
export type { CodeBlockVariants } from './code-block.styles';
export { codeBlockVariants } from './code-block.styles';
