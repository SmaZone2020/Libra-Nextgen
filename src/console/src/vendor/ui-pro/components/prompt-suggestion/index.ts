import type { ComponentProps } from 'react';
import {
  PromptSuggestionDescription,
  PromptSuggestionGroup,
  PromptSuggestionHeader,
  PromptSuggestionItem,
  PromptSuggestionItemDescription,
  PromptSuggestionItemFooter,
  PromptSuggestionItemMeta,
  PromptSuggestionItems,
  PromptSuggestionItemTags,
  PromptSuggestionItemTitle,
  PromptSuggestionRoot,
  PromptSuggestionTitle,
} from './prompt-suggestion';

export { promptSuggestionVariants } from './prompt-suggestion.styles';

const PromptSuggestion = Object.assign(PromptSuggestionRoot, {
  Description: PromptSuggestionDescription,
  Group: PromptSuggestionGroup,
  Header: PromptSuggestionHeader,
  Item: PromptSuggestionItem,
  ItemDescription: PromptSuggestionItemDescription,
  ItemFooter: PromptSuggestionItemFooter,
  ItemMeta: PromptSuggestionItemMeta,
  ItemTags: PromptSuggestionItemTags,
  ItemTitle: PromptSuggestionItemTitle,
  Items: PromptSuggestionItems,
  Root: PromptSuggestionRoot,
  Title: PromptSuggestionTitle,
});

export {
  PromptSuggestion,
  PromptSuggestionDescription,
  PromptSuggestionGroup,
  PromptSuggestionHeader,
  PromptSuggestionItem,
  PromptSuggestionItemDescription,
  PromptSuggestionItemFooter,
  PromptSuggestionItemMeta,
  PromptSuggestionItems,
  PromptSuggestionItemTags,
  PromptSuggestionItemTitle,
  PromptSuggestionRoot,
  PromptSuggestionTitle,
};

export type {
  PromptSuggestionDescriptionProps,
  PromptSuggestionGroupProps,
  PromptSuggestionHeaderProps,
  PromptSuggestionItemDescriptionProps,
  PromptSuggestionItemFooterProps,
  PromptSuggestionItemMetaProps,
  PromptSuggestionItemProps,
  PromptSuggestionItemsProps,
  PromptSuggestionItemTagsProps,
  PromptSuggestionItemTitleProps,
  PromptSuggestionRootProps as PromptSuggestionProps,
  PromptSuggestionRootProps,
  PromptSuggestionTitleProps,
} from './prompt-suggestion';
export type { PromptSuggestionVariants } from './prompt-suggestion.styles';

export type PromptSuggestion = {
  DescriptionProps: ComponentProps<typeof PromptSuggestionDescription>;
  GroupProps: ComponentProps<typeof PromptSuggestionGroup>;
  HeaderProps: ComponentProps<typeof PromptSuggestionHeader>;
  ItemDescriptionProps: ComponentProps<typeof PromptSuggestionItemDescription>;
  ItemFooterProps: ComponentProps<typeof PromptSuggestionItemFooter>;
  ItemMetaProps: ComponentProps<typeof PromptSuggestionItemMeta>;
  ItemProps: ComponentProps<typeof PromptSuggestionItem>;
  ItemsProps: ComponentProps<typeof PromptSuggestionItems>;
  ItemTagsProps: ComponentProps<typeof PromptSuggestionItemTags>;
  ItemTitleProps: ComponentProps<typeof PromptSuggestionItemTitle>;
  Props: ComponentProps<typeof PromptSuggestionRoot>;
  RootProps: ComponentProps<typeof PromptSuggestionRoot>;
  TitleProps: ComponentProps<typeof PromptSuggestionTitle>;
};
