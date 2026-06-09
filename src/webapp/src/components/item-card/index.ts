import type { ComponentProps } from 'react';
import {
  ItemCardAction,
  ItemCardContent,
  ItemCardDescription,
  ItemCardIcon,
  ItemCardRoot,
  ItemCardTitle,
} from './item-card';

export { itemCardVariants } from './item-card.styles';

const ItemCard = Object.assign(ItemCardRoot, {
  Action: ItemCardAction,
  Content: ItemCardContent,
  Description: ItemCardDescription,
  Icon: ItemCardIcon,
  Root: ItemCardRoot,
  Title: ItemCardTitle,
});

export {
  ItemCard,
  ItemCardAction,
  ItemCardContent,
  ItemCardDescription,
  ItemCardIcon,
  ItemCardRoot,
  ItemCardTitle,
};

export type {
  ItemCardActionProps,
  ItemCardContentProps,
  ItemCardDescriptionProps,
  ItemCardIconProps,
  ItemCardRootProps as ItemCardProps,
  ItemCardRootProps,
  ItemCardTitleProps,
} from './item-card';
export type { ItemCardVariants } from './item-card.styles';

export type ItemCard = {
  ActionProps: ComponentProps<typeof ItemCardAction>;
  ContentProps: ComponentProps<typeof ItemCardContent>;
  DescriptionProps: ComponentProps<typeof ItemCardDescription>;
  IconProps: ComponentProps<typeof ItemCardIcon>;
  Props: ComponentProps<typeof ItemCardRoot>;
  RootProps: ComponentProps<typeof ItemCardRoot>;
  TitleProps: ComponentProps<typeof ItemCardTitle>;
};
