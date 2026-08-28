import type { ComponentProps } from 'react';
import {
  ListViewDescription,
  ListViewItem,
  ListViewItemAction,
  ListViewItemContent,
  ListViewRoot,
  ListViewTitle,
} from './list-view';

export { listViewVariants } from './list-view.styles';

const ListView = Object.assign(ListViewRoot, {
  Description: ListViewDescription,
  Item: ListViewItem,
  ItemAction: ListViewItemAction,
  ItemContent: ListViewItemContent,
  Root: ListViewRoot,
  Title: ListViewTitle,
});

export {
  ListView,
  ListViewDescription,
  ListViewItem,
  ListViewItemAction,
  ListViewItemContent,
  ListViewRoot,
  ListViewTitle,
};

export type {
  ListViewDescriptionProps,
  ListViewItemActionProps,
  ListViewItemContentProps,
  ListViewItemProps,
  ListViewRootProps as ListViewProps,
  ListViewRootProps,
  ListViewTitleProps,
} from './list-view';
export type { ListViewVariants } from './list-view.styles';

export type ListView = {
  DescriptionProps: ComponentProps<typeof ListViewDescription>;
  ItemActionProps: ComponentProps<typeof ListViewItemAction>;
  ItemContentProps: ComponentProps<typeof ListViewItemContent>;
  ItemProps: ComponentProps<typeof ListViewItem>;
  Props: ComponentProps<typeof ListViewRoot>;
  RootProps: ComponentProps<typeof ListViewRoot>;
  TitleProps: ComponentProps<typeof ListViewTitle>;
};
