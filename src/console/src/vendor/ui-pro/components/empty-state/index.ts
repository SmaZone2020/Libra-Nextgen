import type { ComponentProps } from 'react';
import {
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateRoot,
  EmptyStateTitle,
} from './empty-state';

export { emptyStateVariants } from './empty-state.styles';

export const EmptyState = Object.assign(EmptyStateRoot, {
  Content: EmptyStateContent,
  Description: EmptyStateDescription,
  Header: EmptyStateHeader,
  Media: EmptyStateMedia,
  Root: EmptyStateRoot,
  Title: EmptyStateTitle,
});

export {
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateRoot,
  EmptyStateTitle,
};

export type {
  EmptyStateContentProps,
  EmptyStateDescriptionProps,
  EmptyStateHeaderProps,
  EmptyStateMediaProps,
  EmptyStateRootProps as EmptyStateProps,
  EmptyStateRootProps,
  EmptyStateTitleProps,
} from './empty-state';
export type { EmptyStateVariants } from './empty-state.styles';
export { emptyStateVariants as default } from './empty-state.styles';

export type EmptyState = {
  ContentProps: ComponentProps<typeof EmptyStateContent>;
  DescriptionProps: ComponentProps<typeof EmptyStateDescription>;
  HeaderProps: ComponentProps<typeof EmptyStateHeader>;
  MediaProps: ComponentProps<typeof EmptyStateMedia>;
  Props: ComponentProps<typeof EmptyStateRoot>;
  RootProps: ComponentProps<typeof EmptyStateRoot>;
  TitleProps: ComponentProps<typeof EmptyStateTitle>;
};
