import {
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerGrid,
  EmojiPickerItem,
  EmojiPickerPopover,
  EmojiPickerRoot,
  EmojiPickerSkinToneContent,
  EmojiPickerSkinToneOption,
  EmojiPickerSkinTonePicker,
  EmojiPickerSkinToneTrigger,
  EmojiPickerTrigger,
  EmojiPickerValue,
} from './emoji-picker';

export { emojiPickerVariants } from './emoji-picker.styles';
export { EMOJI_CATEGORIES, EMOJI_SKIN_TONES } from './emoji-picker-constants';

export const EmojiPicker = Object.assign(EmojiPickerRoot, {
  Content: EmojiPickerContent,
  Footer: EmojiPickerFooter,
  Grid: EmojiPickerGrid,
  Item: EmojiPickerItem,
  Popover: EmojiPickerPopover,
  Root: EmojiPickerRoot,
  SkinToneContent: EmojiPickerSkinToneContent,
  SkinToneOption: EmojiPickerSkinToneOption,
  SkinTonePicker: EmojiPickerSkinTonePicker,
  SkinToneTrigger: EmojiPickerSkinToneTrigger,
  Trigger: EmojiPickerTrigger,
  Value: EmojiPickerValue,
});

export {
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerGrid,
  EmojiPickerItem,
  EmojiPickerPopover,
  EmojiPickerRoot,
  EmojiPickerSkinToneContent,
  EmojiPickerSkinToneOption,
  EmojiPickerSkinTonePicker,
  EmojiPickerSkinToneTrigger,
  EmojiPickerTrigger,
  EmojiPickerValue,
};

export type {
  EmojiPickerContentProps,
  EmojiPickerFooterProps,
  EmojiPickerGridProps,
  EmojiPickerItemProps,
  EmojiPickerPopoverProps,
  EmojiPickerRootProps as EmojiPickerProps,
  EmojiPickerRootProps,
  EmojiPickerSkinToneContentProps,
  EmojiPickerSkinToneOptionProps,
  EmojiPickerSkinTonePickerProps,
  EmojiPickerSkinToneTriggerProps,
  EmojiPickerTriggerProps,
  EmojiPickerValueProps,
} from './emoji-picker';
export type { EmojiPickerVariants } from './emoji-picker.styles';
export type {
  EmojiCategory,
  EmojiCategoryItem,
  EmojiSkinTone,
  EmojiSkinToneItem,
} from './emoji-picker-constants';
