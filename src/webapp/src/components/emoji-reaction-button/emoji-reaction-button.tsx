'use client';

import type { ComponentPropsWithRef } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { ToggleButton as ToggleButtonPrimitive } from 'react-aria-components/ToggleButton';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import type { EmojiReactionButtonVariants } from './emoji-reaction-button.styles';
import { emojiReactionButtonVariants } from './emoji-reaction-button.styles';

// ---- Context ----

type EmojiReactionButtonContextValue = {
  slots?: ReturnType<typeof emojiReactionButtonVariants>;
};

const EmojiReactionButtonContext =
  createContext<EmojiReactionButtonContextValue>({});

// ---- Types ----

export interface EmojiReactionButtonRootProps extends ComponentPropsWithRef<
  typeof ToggleButtonPrimitive
> {
  /** Whether the button is read-only and should not respond to user interaction. */
  isReadOnly?: boolean;
  /** Size variant. @default "md" */
  size?: EmojiReactionButtonVariants['size'];
}

export interface EmojiReactionButtonEmojiProps extends ComponentPropsWithRef<'span'> {}

export interface EmojiReactionButtonCountProps extends ComponentPropsWithRef<'span'> {}

// ---- Components ----

export const EmojiReactionButtonRoot = ({
  children,
  className,
  defaultSelected,
  excludeFromTabOrder,
  isReadOnly,
  isSelected,
  onChange,
  onClick,
  onPress,
  onPressChange,
  onPressEnd,
  onPressStart,
  onPressUp,
  size,
  ...props
}: EmojiReactionButtonRootProps) => {
  const slots = useMemo(() => emojiReactionButtonVariants({ size }), [size]);
  const selectionProps = isReadOnly
    ? { isSelected: isSelected ?? defaultSelected ?? false }
    : { defaultSelected, isSelected };

  return (
    <EmojiReactionButtonContext.Provider value={{ slots }}>
      <ToggleButtonPrimitive
        className={composeTwRenderProps(className, slots?.base())}
        data-readonly={isReadOnly || undefined}
        data-slot="emoji-reaction-button"
        excludeFromTabOrder={!!isReadOnly || excludeFromTabOrder}
        onChange={isReadOnly ? undefined : onChange}
        onClick={isReadOnly ? undefined : onClick}
        onPress={isReadOnly ? undefined : onPress}
        onPressChange={isReadOnly ? undefined : onPressChange}
        onPressEnd={isReadOnly ? undefined : onPressEnd}
        onPressStart={isReadOnly ? undefined : onPressStart}
        onPressUp={isReadOnly ? undefined : onPressUp}
        {...props}
        {...selectionProps}
      >
        {(renderProps) =>
          typeof children === 'function' ? children(renderProps) : children
        }
      </ToggleButtonPrimitive>
    </EmojiReactionButtonContext.Provider>
  );
};

export const EmojiReactionButtonEmoji = ({
  children,
  className,
  ...props
}: EmojiReactionButtonEmojiProps) => {
  const { slots } = useContext(EmojiReactionButtonContext);
  return (
    <span
      className={composeSlotClassName(slots?.emoji, className)}
      data-slot="emoji-reaction-button-emoji"
      {...props}
    >
      {children}
    </span>
  );
};

export const EmojiReactionButtonCount = ({
  children,
  className,
  ...props
}: EmojiReactionButtonCountProps) => {
  const { slots } = useContext(EmojiReactionButtonContext);
  return (
    <span
      className={composeSlotClassName(slots?.count, className)}
      data-slot="emoji-reaction-button-count"
      {...props}
    >
      {children}
    </span>
  );
};
