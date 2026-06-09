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
