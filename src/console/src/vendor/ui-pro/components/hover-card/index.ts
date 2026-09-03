import type { ComponentProps } from 'react';
import {
  HoverCardArrow,
  HoverCardContent,
  HoverCardRoot,
  HoverCardTrigger,
} from './hover-card';

export { hoverCardVariants } from './hover-card.styles';

export const HoverCard = Object.assign(HoverCardRoot, {
  Arrow: HoverCardArrow,
  Content: HoverCardContent,
  Root: HoverCardRoot,
  Trigger: HoverCardTrigger,
});

export { HoverCardArrow, HoverCardContent, HoverCardRoot, HoverCardTrigger };

export type {
  HoverCardArrowProps,
  HoverCardContentProps,
  HoverCardRootProps as HoverCardProps,
  HoverCardRootProps,
  HoverCardTriggerProps,
} from './hover-card';
export type { HoverCardVariants } from './hover-card.styles';
export { hoverCardVariants as default } from './hover-card.styles';

export type HoverCard = {
  ArrowProps: ComponentProps<typeof HoverCardArrow>;
  ContentProps: ComponentProps<typeof HoverCardContent>;
  Props: ComponentProps<typeof HoverCardRoot>;
  RootProps: ComponentProps<typeof HoverCardRoot>;
  TriggerProps: ComponentProps<typeof HoverCardTrigger>;
};
