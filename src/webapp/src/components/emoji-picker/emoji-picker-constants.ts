export const EMOJI_SKIN_TONES = [
  { emoji: '✋', id: 'default', label: 'Default' },
  { emoji: '✋🏻', id: 'light', label: 'Light' },
  { emoji: '✋🏼', id: 'medium-light', label: 'Medium-Light' },
  { emoji: '✋🏽', id: 'medium', label: 'Medium' },
  { emoji: '✋🏾', id: 'medium-dark', label: 'Medium-Dark' },
  { emoji: '✋🏿', id: 'dark', label: 'Dark' },
] as const;

export type EmojiSkinTone = (typeof EMOJI_SKIN_TONES)[number]['id'];
export type EmojiSkinToneItem = { emoji: string; id: string; label: string };

export const EMOJI_CATEGORIES = [
  { emoji: '🕐', id: 'frequently-used', label: 'Frequently Used' },
  { emoji: '😀', id: 'smileys-emotion', label: 'Smileys & Emotion' },
  { emoji: '👋', id: 'people-body', label: 'People & Body' },
  { emoji: '🐶', id: 'animals-nature', label: 'Animals & Nature' },
  { emoji: '🍎', id: 'food-drink', label: 'Food & Drink' },
  { emoji: '⚽', id: 'activities', label: 'Activities' },
  { emoji: '🚗', id: 'travel-places', label: 'Travel & Places' },
  { emoji: '💡', id: 'objects', label: 'Objects' },
  { emoji: '🔣', id: 'symbols', label: 'Symbols' },
  { emoji: '🏁', id: 'flags', label: 'Flags' },
] as const;

export type EmojiCategory = (typeof EMOJI_CATEGORIES)[number]['id'];
export type EmojiCategoryItem = { emoji: string; id: string; label: string };
