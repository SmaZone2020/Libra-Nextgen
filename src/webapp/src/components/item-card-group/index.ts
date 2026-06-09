import type { ComponentProps } from 'react';
import {
  ItemCardGroupDescription,
  ItemCardGroupHeader,
  ItemCardGroupRoot,
  ItemCardGroupTitle,
} from './item-card-group';

export { itemCardGroupVariants } from './item-card-group.styles';

const ItemCardGroup = Object.assign(ItemCardGroupRoot, {
  Description: ItemCardGroupDescription,
  Header: ItemCardGroupHeader,
  Root: ItemCardGroupRoot,
  Title: ItemCardGroupTitle,
});

export {
  ItemCardGroup,
  ItemCardGroupDescription,
  ItemCardGroupHeader,
  ItemCardGroupRoot,
  ItemCardGroupTitle,
};

export type {
  ItemCardGroupDescriptionProps,
  ItemCardGroupHeaderProps,
  ItemCardGroupRootProps as ItemCardGroupProps,
  ItemCardGroupRootProps,
  ItemCardGroupTitleProps,
} from './item-card-group';
export type { ItemCardGroupVariants } from './item-card-group.styles';

export type ItemCardGroup = {
  DescriptionProps: ComponentProps<typeof ItemCardGroupDescription>;
  HeaderProps: ComponentProps<typeof ItemCardGroupHeader>;
  Props: ComponentProps<typeof ItemCardGroupRoot>;
  RootProps: ComponentProps<typeof ItemCardGroupRoot>;
  TitleProps: ComponentProps<typeof ItemCardGroupTitle>;
};
