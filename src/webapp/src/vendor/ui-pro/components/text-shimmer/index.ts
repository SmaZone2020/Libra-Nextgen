import type { ComponentProps } from 'react';
import { TextShimmer } from './text-shimmer';

export { TextShimmer };
export type { TextShimmerProps } from './text-shimmer';
export type {
  TextShimmerRenderProps,
  TextShimmerVariants,
} from './text-shimmer.styles';
export { textShimmerVariants } from './text-shimmer.styles';

export type TextShimmer = {
  Props: ComponentProps<typeof TextShimmer>;
};
