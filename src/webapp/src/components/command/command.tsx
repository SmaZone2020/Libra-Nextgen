'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import React from 'react';
import { createContext, useContext, useMemo } from 'react';
import { Autocomplete, useFilter } from 'react-aria-components/Autocomplete';
import { Dialog } from 'react-aria-components/Dialog';
import { Header } from 'react-aria-components/Header';
import { Input } from 'react-aria-components/Input';
import {
  Menu,
  MenuItem,
  MenuSection,
  Separator,
} from 'react-aria-components/Menu';
import { Modal, ModalOverlay } from 'react-aria-components/Modal';
import { SearchField } from 'react-aria-components/SearchField';
import { CloseButton } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { CommandVariants } from './command.styles';
import { commandVariants } from './command.styles';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CommandRootProps {
  children: ReactNode;
}

export interface CommandBackdropProps extends ComponentPropsWithRef<
  typeof ModalOverlay
> {
  /** Whether clicking the backdrop closes the palette. @default true */
  isDismissable?: boolean;
  /** Backdrop style variant. @default "opaque" */
  variant?: CommandVariants['variant'];
}

export interface CommandContainerProps extends Omit<
  ComponentPropsWithRef<typeof Modal>,
  Exclude<keyof CommandBackdropProps, 'children' | 'className'>
> {
  size?: CommandVariants['size'];
}

export interface CommandDialogProps extends Omit<
  ComponentPropsWithRef<typeof Dialog>,
  'children'
> {
  children: ReactNode;
  /** Default input value for the search field (uncontrolled). */
  defaultInputValue?: string;
  /** Custom filter function. Defaults to case-insensitive contains. */
  filter?: (textValue: string, inputValue: string) => boolean;
  /** Controlled input value for the search field. */
  inputValue?: string;
  /** Callback when input value changes. */
  onInputChange?: (value: string) => void;
}

export interface CommandInputGroupProps extends Omit<
  ComponentPropsWithRef<typeof SearchField>,
  'children'
> {
  children: ReactNode;
}

export interface CommandInputGroupPrefixProps extends ComponentPropsWithRef<'div'> {}

export interface CommandInputGroupInputProps extends ComponentPropsWithRef<
  typeof Input
> {}

export interface CommandInputGroupSuffixProps extends ComponentPropsWithRef<'div'> {}

export interface CommandInputGroupClearButtonProps extends ComponentPropsWithRef<
  typeof CloseButton
> {}

export interface CommandHeaderProps extends ComponentPropsWithRef<'div'> {}

export interface CommandListProps<
  T extends object,
> extends ComponentPropsWithRef<typeof Menu<T>> {}

export interface CommandItemProps<
  T extends object,
> extends ComponentPropsWithRef<typeof MenuItem<T>> {}

export interface CommandGroupProps<
  T extends object,
> extends ComponentPropsWithRef<typeof MenuSection<T>> {
  /** Heading label for the group. */
  heading?: ReactNode;
}

export interface CommandSeparatorProps extends ComponentPropsWithRef<
  typeof Separator
> {}

export interface CommandFooterProps extends ComponentPropsWithRef<'div'> {}

// ── Context ──────────────────────────────────────────────────────────────────

interface CommandContextValue {
  slots?: ReturnType<typeof commandVariants>;
}

const CommandContext = createContext<CommandContextValue>({});

// ── Components ───────────────────────────────────────────────────────────────

export const CommandRoot = ({ children }: CommandRootProps) => {
  const slots = useMemo(() => commandVariants(), []);

  return <CommandContext value={{ slots }}>{children}</CommandContext>;
};

export const CommandBackdrop = ({
  children,
  className,
  isDismissable = true,
  variant,
  ...props
}: CommandBackdropProps) => {
  const slots = useMemo(() => commandVariants({ variant }), [variant]);

  return (
    <ModalOverlay
      className={composeTwRenderProps(className, slots?.backdrop())}
      data-slot="command-backdrop"
      isDismissable={isDismissable}
      {...props}
    >
      {(state) => ('function' === typeof children ? children(state) : children)}
    </ModalOverlay>
  );
};

export const CommandContainer = ({
  children,
  className,
  size,
  ...props
}: CommandContainerProps) => {
  const { slots: contextSlots } = useContext(CommandContext);
  const sizeSlots = useMemo(() => commandVariants({ size }), [size]);
  const mergedContext = useMemo(
    () => ({ slots: { ...contextSlots, ...sizeSlots } }),
    [contextSlots, sizeSlots]
  );

  return (
    <Modal
      className={composeTwRenderProps(className, sizeSlots?.container())}
      data-slot="command-container"
      {...props}
    >
      {(state) => (
        <CommandContext value={mergedContext}>
          {'function' === typeof children ? children(state) : children}
        </CommandContext>
      )}
    </Modal>
  );
};

export const CommandDialog = ({
  children,
  className,
  defaultInputValue,
  filter,
  inputValue,
  onInputChange,
  ...props
}: CommandDialogProps) => {
  const { contains } = useFilter({ sensitivity: 'base' });
  const { slots } = useContext(CommandContext);

  return (
    <Dialog
      aria-label="Command palette"
      className={composeSlotClassName(slots?.dialog, className)}
      data-slot="command-dialog"
      {...props}
    >
      <Autocomplete
        defaultInputValue={defaultInputValue}
        filter={filter ?? contains}
        inputValue={inputValue}
        onInputChange={onInputChange}
      >
        {children}
      </Autocomplete>
    </Dialog>
  );
};

export const CommandInputGroup = ({
  autoFocus = true,
  children,
  className,
  ...props
}: CommandInputGroupProps) => {
  const { slots } = useContext(CommandContext);

  return (
    <SearchField
      aria-label={props['aria-label'] ?? 'Search commands'}
      autoFocus={autoFocus}
      className={composeTwRenderProps(className, slots?.inputGroup())}
      data-slot="command-input-group"
      {...props}
    >
      {children}
    </SearchField>
  );
};

export const CommandInputGroupPrefix = ({
  children,
  className,
  ...props
}: CommandInputGroupPrefixProps) => {
  const { slots } = useContext(CommandContext);

  return (
    <div
      className={composeSlotClassName(slots?.inputGroupPrefix, className)}
      data-slot="command-input-group-prefix"
      {...props}
    >
      {children}
    </div>
  );
};

export const CommandInputGroupInput = ({
  className,
  onKeyDownCapture: onKeyDownCaptureProp,
  placeholder = 'Search commands...',
  ...props
}: CommandInputGroupInputProps) => (
  <Input
    className={className}
    data-slot="command-input-group-input"
    placeholder={placeholder}
    {...props}
    onKeyDownCapture={(e) => {
      onKeyDownCaptureProp?.(e);
      if (
        !e.defaultPrevented &&
        e.key.length === 1 &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.stopPropagation();
      }
    }}
  />
);

export const CommandInputGroupSuffix = ({
  children,
  className,
  ...props
}: CommandInputGroupSuffixProps) => {
  const { slots } = useContext(CommandContext);

  return (
    <div
      className={composeSlotClassName(slots?.inputGroupSuffix, className)}
      data-slot="command-input-group-suffix"
      {...props}
    >
      {children}
    </div>
  );
};

export const CommandInputGroupClearButton = ({
  className,
  ...props
}: CommandInputGroupClearButtonProps) => {
  const { slots } = useContext(CommandContext);

  return (
    <CloseButton
      className={composeTwRenderProps(
        className,
        slots?.inputGroupClearButton()
      )}
      data-slot="command-input-group-clear-button"
      slot="clear"
      {...props}
    />
  );
};

export const CommandHeader = ({
  children,
  className,
  ...props
}: CommandHeaderProps) => {
  const { slots } = useContext(CommandContext);

  return (
    <div
      className={composeSlotClassName(slots?.header, className)}
      data-slot="command-header"
      {...props}
    >
      {children}
    </div>
  );
};

export const CommandList = <T extends object>({
  children,
  className,
  renderEmptyState,
  ...props
}: CommandListProps<T>) => {
  const { slots } = useContext(CommandContext);
  const emptyState = renderEmptyState
    ? () => (
        <div className={slots?.empty()} data-slot="command-empty">
          {renderEmptyState()}
        </div>
      )
    : undefined;

  return (
    <Menu
      className={composeTwRenderProps(className, slots?.list())}
      data-slot="command-list"
      renderEmptyState={emptyState}
      {...props}
    >
      {children}
    </Menu>
  );
};

export const CommandItem = <T extends object>({
  children,
  className,
  ...props
}: CommandItemProps<T>) => {
  const { slots } = useContext(CommandContext);

  return (
    <MenuItem
      className={composeTwRenderProps(className, slots?.item())}
      data-slot="command-item"
      {...props}
    >
      {children}
    </MenuItem>
  );
};

export const CommandGroup = <T extends object>({
  children,
  className,
  heading,
  ...props
}: CommandGroupProps<T>) => {
  const { slots } = useContext(CommandContext);

  return (
    <MenuSection
      className={composeSlotClassName(slots?.group, className)}
      data-slot="command-group"
      {...props}
    >
      {!!heading && (
        <Header
          className={slots?.groupHeading()}
          data-slot="command-group-heading"
        >
          {heading}
        </Header>
      )}
      {children as React.ReactNode}
    </MenuSection>
  );
};

export const CommandSeparator = ({
  className,
  ...props
}: CommandSeparatorProps) => {
  const { slots } = useContext(CommandContext);

  return (
    <Separator
      className={composeSlotClassName(slots?.separator, className)}
      data-slot="command-separator"
      {...props}
    />
  );
};

export const CommandFooter = ({
  children,
  className,
  ...props
}: CommandFooterProps) => {
  const { slots } = useContext(CommandContext);

  return (
    <div
      className={composeSlotClassName(slots?.footer, className)}
      data-slot="command-footer"
      {...props}
    >
      {children}
    </div>
  );
};
