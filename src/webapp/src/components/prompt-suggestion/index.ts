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
