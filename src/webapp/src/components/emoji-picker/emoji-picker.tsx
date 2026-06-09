'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo, useState } from 'react';
import { Autocomplete, useFilter } from 'react-aria-components/Autocomplete';
import { Button as ButtonPrimitive } from 'react-aria-components/Button';
import {
  ListBox as ListBoxPrimitive,
  ListBoxItem as ListBoxItemPrimitive,
} from 'react-aria-components/ListBox';
import { Popover as PopoverPrimitive } from 'react-aria-components/Popover';
import {
  Select as SelectPrimitive,
  SelectValue as SelectValuePrimitive,
} from 'react-aria-components/Select';
import {
  GridLayout,
  Size,
  Virtualizer,
} from 'react-aria-components/Virtualizer';
import type { PopoverContentProps } from '@heroui/react';
import { Popover } from '@heroui/react';
import { useControlledState } from '@react-stately/utils';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { EMOJI_SKIN_TONES } from './emoji-picker-constants';
export { EMOJI_CATEGORIES } from './emoji-picker-constants';
import type { EmojiPickerVariants } from './emoji-picker.styles';
import { emojiPickerVariants } from './emoji-picker.styles';
import type { EmojiSkinToneItem } from './emoji-picker-constants';

// ---- Context ----

type EmojiPickerContextValue = {
  slots?: ReturnType<typeof emojiPickerVariants>;
};

const EmojiPickerContext = createContext<EmojiPickerContextValue>({});

type SkinToneContextValue = {
  close: () => void;
  setValue: (value: string) => void;
  value: string;
};

const SkinToneContext = createContext<SkinToneContextValue>({
  close: () => {},
  setValue: () => {},
  value: 'default',
});

// ---- Types ----

export interface EmojiPickerRootProps extends ComponentPropsWithRef<
  typeof SelectPrimitive
> {
  /** Size variant controlling trigger, popover, and emoji dimensions. @default "md" */
  size?: EmojiPickerVariants['size'];
}

export interface EmojiPickerTriggerProps extends ComponentPropsWithRef<
  typeof ButtonPrimitive
> {}

export interface EmojiPickerValueProps<
  T extends object,
> extends ComponentPropsWithRef<typeof SelectValuePrimitive<T>> {}

export interface EmojiPickerPopoverProps extends ComponentPropsWithRef<
  typeof PopoverPrimitive
> {}

export interface EmojiPickerContentProps extends ComponentPropsWithRef<'div'> {
  /** Custom filter function. Defaults to case-insensitive contains. */
  filter?: (textValue: string, inputValue: string) => boolean;
}

export interface EmojiPickerGridProps<T extends object> extends Omit<
  ComponentPropsWithRef<typeof ListBoxPrimitive<T>>,
  'layout'
> {
  /** Virtualizer grid layout options for item sizing and spacing. */
  layoutOptions?: {
    minItemSize?: InstanceType<typeof Size>;
    maxItemSize?: InstanceType<typeof Size>;
    minSpace?: InstanceType<typeof Size>;
    preserveAspectRatio?: boolean;
  };
}

export interface EmojiPickerItemProps<
  T extends object,
> extends ComponentPropsWithRef<typeof ListBoxItemPrimitive<T>> {}

export interface EmojiPickerSkinTonePickerProps {
  children: ReactNode;
  /** The default skin tone (uncontrolled). @default "default" */
  defaultValue?: string;
  /** Callback when the skin tone changes. */
  onChange?: (value: string) => void;
  /** The selected skin tone (controlled). */
  value?: string;
}

export interface EmojiPickerSkinToneTriggerProps {
  'aria-label'?: string;
  children?: ReactNode;
  className?: string;
  /** Skin tone data for resolving the current value's emoji. @default EMOJI_SKIN_TONES */
  tones?: EmojiSkinToneItem[];
}

export interface EmojiPickerSkinToneContentProps {
  'aria-label'?: string;
  children: ReactNode;
  className?: string;
  /** @default 4 */
  offset?: number;
  /** @default "bottom end" */
  placement?: PopoverContentProps['placement'];
}

export interface EmojiPickerSkinToneOptionProps extends ComponentPropsWithRef<'button'> {
  id: string;
}

export interface EmojiPickerFooterProps extends ComponentPropsWithRef<'div'> {}

// ---- Components ----

const DEFAULT_LAYOUT_OPTIONS = {
  maxItemSize: new Size(36, 36),
  minItemSize: new Size(36, 36),
  minSpace: new Size(2, 2),
  preserveAspectRatio: true,
};

export const EmojiPickerRoot = ({
  children,
  size,
  ...props
}: EmojiPickerRootProps) => {
  const slots = useMemo(() => emojiPickerVariants({ size }), [size]);
  return (
    <EmojiPickerContext.Provider value={{ slots }}>
      <SelectPrimitive data-slot="emoji-picker" {...props}>
        {children}
      </SelectPrimitive>
    </EmojiPickerContext.Provider>
  );
};

export const EmojiPickerTrigger = ({
  children,
  className,
  ...props
}: EmojiPickerTriggerProps) => {
  const { slots } = useContext(EmojiPickerContext);
  return (
    <ButtonPrimitive
      className={composeTwRenderProps(className, slots?.trigger())}
      data-slot="emoji-picker-trigger"
      {...props}
    >
      {(renderProps) =>
        typeof children === 'function' ? children(renderProps) : children
      }
    </ButtonPrimitive>
  );
};

export const EmojiPickerValue = <T extends object>({
  className,
  ...props
}: EmojiPickerValueProps<T>) => {
  const { slots } = useContext(EmojiPickerContext);
  return (
    <SelectValuePrimitive
      className={composeTwRenderProps(className, slots?.value())}
      data-slot="emoji-picker-value"
      {...props}
    />
  );
};

export const EmojiPickerPopover = ({
  children,
  className,
  offset = 4,
  placement = 'bottom',
  ...props
}: EmojiPickerPopoverProps) => {
  const { slots } = useContext(EmojiPickerContext);
  return (
    <PopoverPrimitive
      className={composeTwRenderProps(className, slots?.popover())}
      data-slot="emoji-picker-popover"
      offset={offset}
      placement={placement}
      {...props}
    >
      {(renderProps) =>
        typeof children === 'function' ? children(renderProps) : children
      }
    </PopoverPrimitive>
  );
};

export const EmojiPickerContent = ({
  children,
  className,
  filter,
  ...props
}: EmojiPickerContentProps) => {
  const { contains } = useFilter({ sensitivity: 'base' });
  const { slots } = useContext(EmojiPickerContext);
  return (
    <div
      className={composeSlotClassName(slots?.content, className)}
      data-slot="emoji-picker-content"
      {...props}
    >
      <Autocomplete filter={filter ?? contains}>{children}</Autocomplete>
    </div>
  );
};

export const EmojiPickerGrid = <T extends object>({
  children,
  className,
  layoutOptions,
  renderEmptyState,
  ...props
}: EmojiPickerGridProps<T>) => {
  const { slots } = useContext(EmojiPickerContext);
  const mergedLayout = useMemo(
    () => ({ ...DEFAULT_LAYOUT_OPTIONS, ...layoutOptions }),
    [layoutOptions]
  );
  const emptyState = renderEmptyState
    ? (renderProps: Parameters<typeof renderEmptyState>[0]) => (
        <div className={slots?.empty()} data-slot="emoji-picker-empty">
          {renderEmptyState(renderProps)}
        </div>
      )
    : undefined;

  return (
    <Virtualizer layout={GridLayout} layoutOptions={mergedLayout}>
      <ListBoxPrimitive
        aria-label={props['aria-label'] ?? 'Emoji grid'}
        className={composeTwRenderProps(className, slots?.grid())}
        data-slot="emoji-picker-grid"
        layout="grid"
        renderEmptyState={emptyState}
        {...props}
      >
        {children}
      </ListBoxPrimitive>
    </Virtualizer>
  );
};

export const EmojiPickerItem = <T extends object>({
  children,
  className,
  ...props
}: EmojiPickerItemProps<T>) => {
  const { slots } = useContext(EmojiPickerContext);
  return (
    <ListBoxItemPrimitive
      className={composeTwRenderProps(className, slots?.item())}
      data-slot="emoji-picker-item"
      {...props}
    >
      {(renderProps) =>
        typeof children === 'function' ? children(renderProps) : children
      }
    </ListBoxItemPrimitive>
  );
};

export const EmojiPickerSkinTonePicker = ({
  children,
  defaultValue = 'default',
  onChange,
  value: valueProp,
}: EmojiPickerSkinTonePickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useControlledState(
    valueProp,
    defaultValue,
    onChange
  );
  const contextValue = useMemo(
    () => ({ close: () => setIsOpen(false), setValue, value }),
    [setValue, value]
  );
  return (
    <SkinToneContext.Provider value={contextValue}>
      <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
        {children}
      </Popover>
    </SkinToneContext.Provider>
  );
};

export const EmojiPickerSkinToneTrigger = ({
  'aria-label': ariaLabel = 'Select skin tone',
  children,
  className,
  tones = EMOJI_SKIN_TONES as unknown as EmojiSkinToneItem[],
}: EmojiPickerSkinToneTriggerProps) => {
  const { value } = useContext(SkinToneContext);
  const { slots } = useContext(EmojiPickerContext);
  const current = tones.find((t) => t.id === value) ?? tones[0];
  return (
    <Popover.Trigger>
      <ButtonPrimitive
        aria-label={ariaLabel}
        className={composeTwRenderProps(className, slots?.skinTonePicker())}
        data-slot="emoji-picker-skin-tone-picker"
      >
        {children ?? current?.emoji}
      </ButtonPrimitive>
    </Popover.Trigger>
  );
};

export const EmojiPickerSkinToneContent = ({
  'aria-label': ariaLabel = 'Skin tone',
  children,
  className,
  offset = 4,
  placement = 'bottom end',
}: EmojiPickerSkinToneContentProps) => {
  const { slots } = useContext(EmojiPickerContext);
  return (
    <Popover.Content offset={offset} placement={placement}>
      <Popover.Dialog
        aria-label={ariaLabel}
        className={composeSlotClassName(slots?.skinToneOptions, className)}
        data-slot="emoji-picker-skin-tone-options"
      >
        {children}
      </Popover.Dialog>
    </Popover.Content>
  );
};

export const EmojiPickerSkinToneOption = ({
  children,
  className,
  id,
  ...props
}: EmojiPickerSkinToneOptionProps) => {
  const { close, setValue, value } = useContext(SkinToneContext);
  const { slots } = useContext(EmojiPickerContext);
  return (
    <button
      type="button"
      {...props}
      className={composeSlotClassName(slots?.skinToneOption, className)}
      data-selected={id === value ? 'true' : undefined}
      data-slot="emoji-picker-skin-tone-option"
      onClick={() => {
        setValue(id);
        close();
      }}
    >
      {children}
    </button>
  );
};

export const EmojiPickerFooter = ({
  children,
  className,
  ...props
}: EmojiPickerFooterProps) => {
  const { slots } = useContext(EmojiPickerContext);
  return (
    <div
      className={composeSlotClassName(slots?.footer, className)}
      data-slot="emoji-picker-footer"
      {...props}
    >
      {children}
    </div>
  );
};

export { EMOJI_SKIN_TONES };
