import {
  EmojiReactionButtonCount,
  EmojiReactionButtonEmoji,
  EmojiReactionButtonRoot,
} from './emoji-reaction-button';

export { emojiReactionButtonVariants } from './emoji-reaction-button.styles';

export const EmojiReactionButton = Object.assign(EmojiReactionButtonRoot, {
  Count: EmojiReactionButtonCount,
  Emoji: EmojiReactionButtonEmoji,
  Root: EmojiReactionButtonRoot,
});

export {
  EmojiReactionButtonCount,
  EmojiReactionButtonEmoji,
  EmojiReactionButtonRoot,
};

export type {
  EmojiReactionButtonCountProps,
  EmojiReactionButtonEmojiProps,
  EmojiReactionButtonRootProps as EmojiReactionButtonProps,
  EmojiReactionButtonRootProps,
} from './emoji-reaction-button';
export type { EmojiReactionButtonVariants } from './emoji-reaction-button.styles';
export { emojiReactionButtonVariants as default } from './emoji-reaction-button.styles';
