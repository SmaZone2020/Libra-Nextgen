'use client';

import {
  type ComponentPropsWithRef,
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { Button as ButtonPrimitive } from 'react-aria-components/Button';
import { Card } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { ChevronRight } from '../icons';
import type { PromptSuggestionVariants } from './prompt-suggestion.styles';
import { promptSuggestionVariants } from './prompt-suggestion.styles';

type PromptSuggestionContextValue = {
  slots?: ReturnType<typeof promptSuggestionVariants>;
  variant?: PromptSuggestionVariants['variant'];
};

const PromptSuggestionContext = createContext<PromptSuggestionContextValue>({});

/** Returns context slots, falling back to a fresh calculation if not in context. */
const useSlots = (): ReturnType<typeof promptSuggestionVariants> => {
  const { slots, variant } = useContext(PromptSuggestionContext);
  const fresh = useMemo(
    () => promptSuggestionVariants({ variant: variant ?? 'pill' }),
    [variant]
  );
  return slots ?? fresh;
};

// ──────────────────────── Root ───────────────────────────────────

export interface PromptSuggestionRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** @default "pill" */
  variant?: PromptSuggestionVariants['variant'];
}

export const PromptSuggestionRoot = ({
  children,
  className,
  variant = 'pill',
  ...props
}: PromptSuggestionRootProps) => {
  const slots = useMemo(() => promptSuggestionVariants({ variant }), [variant]);
  return jsx(PromptSuggestionContext, {
    value: { slots, variant },
    children: jsx('div', {
      className: composeSlotClassName(slots?.base, className),
      'data-slot': 'prompt-suggestion',
      ...props,
      children,
    }),
  });
};

// ──────────────────────── Header ─────────────────────────────────

export interface PromptSuggestionHeaderProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const PromptSuggestionHeader = ({
  children,
  className,
  ...props
}: PromptSuggestionHeaderProps) => {
  const slots = useSlots();
  return jsx('div', {
    className: composeSlotClassName(slots?.header, className),
    'data-slot': 'prompt-suggestion-header',
    ...props,
    children,
  });
};

// ──────────────────────── Title ──────────────────────────────────

export interface PromptSuggestionTitleProps extends ComponentPropsWithRef<'h2'> {
  children: ReactNode;
}

export const PromptSuggestionTitle = ({
  children,
  className,
  ...props
}: PromptSuggestionTitleProps) => {
  const slots = useSlots();
  return jsx('h2', {
    className: composeSlotClassName(slots?.title, className),
    'data-slot': 'prompt-suggestion-title',
    ...props,
    children,
  });
};

// ──────────────────────── Description ───────────────────────────

export interface PromptSuggestionDescriptionProps extends ComponentPropsWithRef<'p'> {
  children: ReactNode;
}

export const PromptSuggestionDescription = ({
  children,
  className,
  ...props
}: PromptSuggestionDescriptionProps) => {
  const slots = useSlots();
  return jsx('p', {
    className: composeSlotClassName(slots?.description, className),
    'data-slot': 'prompt-suggestion-description',
    ...props,
    children,
  });
};

// ──────────────────────── Group ──────────────────────────────────

export interface PromptSuggestionGroupProps extends ComponentPropsWithRef<'section'> {
  children: ReactNode;
  description?: ReactNode;
  label?: ReactNode;
}

export const PromptSuggestionGroup = ({
  children,
  className,
  description,
  label,
  ...props
}: PromptSuggestionGroupProps) => {
  const slots = useSlots();
  return jsxs('section', {
    className: composeSlotClassName(slots?.group, className),
    'data-slot': 'prompt-suggestion-group',
    ...props,
    children: [
      (label || description) &&
        jsxs('div', {
          className: 'flex flex-col gap-1',
          children: [
            label
              ? jsx('h3', {
                  className: composeSlotClassName(slots?.groupLabel, undefined),
                  children: label,
                })
              : null,
            description
              ? jsx('p', {
                  className: composeSlotClassName(
                    slots?.groupDescription,
                    undefined
                  ),
                  children: description,
                })
              : null,
          ],
        }),
      children,
    ],
  });
};

// ──────────────────────── Items ──────────────────────────────────

export interface PromptSuggestionItemsProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const PromptSuggestionItems = ({
  children,
  className,
  ...props
}: PromptSuggestionItemsProps) => {
  const slots = useSlots();
  return jsx('div', {
    className: composeSlotClassName(slots?.items, className),
    'data-slot': 'prompt-suggestion-items',
    ...props,
    children,
  });
};

// ──────────────────────── Item ───────────────────────────────────

export interface PromptSuggestionItemProps extends Omit<
  ComponentPropsWithRef<typeof ButtonPrimitive>,
  'className'
> {
  children: ReactNode;
  className?: string;
  /** Show the hover arrow on pill items. @default true */
  showEndIcon?: boolean;
}

export const PromptSuggestionItem = ({
  children,
  className,
  showEndIcon = true,
  ...props
}: PromptSuggestionItemProps) => {
  const { variant } = useContext(PromptSuggestionContext);
  const slots = useSlots();

  if (variant === 'card') {
    return jsx(Card, {
      className: composeSlotClassName(slots?.item, className),
      'data-slot': 'prompt-suggestion-item',
      ...props,
      children,
    });
  }

  return jsxs(ButtonPrimitive, {
    className: composeTwRenderProps(className, slots?.item()),
    'data-slot': 'prompt-suggestion-item',
    ...props,
    children: [
      jsx('span', {
        className: composeSlotClassName(slots?.itemLabel, undefined),
        children,
      }),
      showEndIcon
        ? jsx(ChevronRight, {
            className: composeSlotClassName(slots?.itemEndIcon, undefined),
          })
        : null,
    ],
  });
};

// ──────────────────────── Item Title ─────────────────────────────

export interface PromptSuggestionItemTitleProps extends ComponentPropsWithRef<
  typeof Card.Title
> {
  children: ReactNode;
}

export const PromptSuggestionItemTitle = ({
  children,
  className,
  ...props
}: PromptSuggestionItemTitleProps) => {
  return jsx(Card.Title, {
    className,
    'data-slot': 'prompt-suggestion-item-title',
    ...props,
    children,
  });
};

// ──────────────────────── Item Description ───────────────────────

export interface PromptSuggestionItemDescriptionProps extends ComponentPropsWithRef<
  typeof Card.Description
> {
  children: ReactNode;
}

export const PromptSuggestionItemDescription = ({
  children,
  className,
  ...props
}: PromptSuggestionItemDescriptionProps) => {
  const slots = useSlots();
  return jsx(Card.Description, {
    className: composeSlotClassName(slots?.itemDescription, className),
    ...props,
    children,
  });
};

// ──────────────────────── Item Footer ────────────────────────────

export interface PromptSuggestionItemFooterProps extends ComponentPropsWithRef<
  typeof Card.Footer
> {
  children: ReactNode;
}

export const PromptSuggestionItemFooter = ({
  children,
  className,
  ...props
}: PromptSuggestionItemFooterProps) => {
  const slots = useSlots();
  return jsx(Card.Footer, {
    className: composeSlotClassName(slots?.itemFooter, className),
    'data-slot': 'prompt-suggestion-item-footer',
    ...props,
    children,
  });
};

// ──────────────────────── Item Tags ──────────────────────────────

export interface PromptSuggestionItemTagsProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const PromptSuggestionItemTags = ({
  children,
  className,
  ...props
}: PromptSuggestionItemTagsProps) => {
  const slots = useSlots();
  return jsx('div', {
    className: composeSlotClassName(slots?.itemTags, className),
    'data-slot': 'prompt-suggestion-item-tags',
    ...props,
    children,
  });
};

// ──────────────────────── Item Meta ──────────────────────────────

export interface PromptSuggestionItemMetaProps extends ComponentPropsWithRef<'span'> {
  children: ReactNode;
}

export const PromptSuggestionItemMeta = ({
  children,
  className,
  ...props
}: PromptSuggestionItemMetaProps) => {
  const slots = useSlots();
  return jsx('span', {
    className: composeSlotClassName(slots?.itemMeta, className),
    'data-slot': 'prompt-suggestion-item-meta',
    ...props,
    children,
  });
};
