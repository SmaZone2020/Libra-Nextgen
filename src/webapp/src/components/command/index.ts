import type { ComponentProps } from 'react';
import {
  CommandBackdrop,
  CommandContainer,
  CommandDialog,
  CommandFooter,
  CommandGroup,
  CommandHeader,
  CommandInputGroup,
  CommandInputGroupClearButton,
  CommandInputGroupInput,
  CommandInputGroupPrefix,
  CommandInputGroupSuffix,
  CommandItem,
  CommandList,
  CommandRoot,
  CommandSeparator,
} from './command';

export const Command = Object.assign(CommandRoot, {
  Root: CommandRoot,
  Backdrop: CommandBackdrop,
  Container: CommandContainer,
  Dialog: CommandDialog,
  Header: CommandHeader,
  InputGroup: Object.assign(CommandInputGroup, {
    Prefix: CommandInputGroupPrefix,
    Input: CommandInputGroupInput,
    ClearButton: CommandInputGroupClearButton,
    Suffix: CommandInputGroupSuffix,
  }),
  List: CommandList,
  Item: CommandItem,
  Group: CommandGroup,
  Separator: CommandSeparator,
  Footer: CommandFooter,
});

export type Command<T extends object = object> = {
  Props: ComponentProps<typeof CommandRoot>;
  RootProps: ComponentProps<typeof CommandRoot>;
  BackdropProps: ComponentProps<typeof CommandBackdrop>;
  ContainerProps: ComponentProps<typeof CommandContainer>;
  DialogProps: ComponentProps<typeof CommandDialog>;
  HeaderProps: ComponentProps<typeof CommandHeader>;
  InputGroupProps: ComponentProps<typeof CommandInputGroup>;
  InputGroupPrefixProps: ComponentProps<typeof CommandInputGroupPrefix>;
  InputGroupInputProps: ComponentProps<typeof CommandInputGroupInput>;
  InputGroupClearButtonProps: ComponentProps<
    typeof CommandInputGroupClearButton
  >;
  InputGroupSuffixProps: ComponentProps<typeof CommandInputGroupSuffix>;
  ListProps: ComponentProps<typeof CommandList<T>>;
  ItemProps: ComponentProps<typeof CommandItem<T>>;
  GroupProps: ComponentProps<typeof CommandGroup<T>>;
  SeparatorProps: ComponentProps<typeof CommandSeparator>;
  FooterProps: ComponentProps<typeof CommandFooter>;
};

export {
  CommandBackdrop,
  CommandContainer,
  CommandDialog,
  CommandFooter,
  CommandGroup,
  CommandHeader,
  CommandInputGroup,
  CommandInputGroupClearButton,
  CommandInputGroupInput,
  CommandInputGroupPrefix,
  CommandInputGroupSuffix,
  CommandItem,
  CommandList,
  CommandRoot,
  CommandSeparator,
};
export type {
  CommandBackdropProps,
  CommandContainerProps,
  CommandDialogProps,
  CommandFooterProps,
  CommandGroupProps,
  CommandHeaderProps,
  CommandInputGroupClearButtonProps,
  CommandInputGroupInputProps,
  CommandInputGroupPrefixProps,
  CommandInputGroupProps,
  CommandInputGroupSuffixProps,
  CommandItemProps,
  CommandListProps,
  CommandRootProps as CommandProps,
  CommandRootProps,
  CommandSeparatorProps,
} from './command';
export type { CommandVariants } from './command.styles';
export { commandVariants } from './command.styles';
