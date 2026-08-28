import type { ComponentProps } from 'react';
import {
  ChatLoaderDots,
  ChatLoaderPulse,
  ChatLoaderSkeleton,
  ChatLoaderSkeletonAvatar,
  ChatLoaderSkeletonBlock,
  ChatLoaderSkeletonLine,
  ChatLoaderSpinner,
} from './chat-loader';

export type {
  ChatLoaderDotsProps,
  ChatLoaderPulseProps,
  ChatLoaderSkeletonAvatarProps,
  ChatLoaderSkeletonBlockProps,
  ChatLoaderSkeletonLineProps,
  ChatLoaderSkeletonProps,
  ChatLoaderSpinnerProps,
} from './chat-loader';
export type { ChatLoaderVariants } from './chat-loader.styles';
export { chatLoaderVariants } from './chat-loader.styles';

const ChatLoader = {
  Dots: ChatLoaderDots,
  Pulse: ChatLoaderPulse,
  Skeleton: ChatLoaderSkeleton,
  SkeletonAvatar: ChatLoaderSkeletonAvatar,
  SkeletonBlock: ChatLoaderSkeletonBlock,
  SkeletonLine: ChatLoaderSkeletonLine,
  Spinner: ChatLoaderSpinner,
};

export {
  ChatLoader,
  ChatLoaderDots,
  ChatLoaderPulse,
  ChatLoaderSkeleton,
  ChatLoaderSkeletonAvatar,
  ChatLoaderSkeletonBlock,
  ChatLoaderSkeletonLine,
  ChatLoaderSpinner,
};

export type ChatLoader = {
  DotsProps: ComponentProps<typeof ChatLoaderDots>;
  PulseProps: ComponentProps<typeof ChatLoaderPulse>;
  SkeletonAvatarProps: ComponentProps<typeof ChatLoaderSkeletonAvatar>;
  SkeletonBlockProps: ComponentProps<typeof ChatLoaderSkeletonBlock>;
  SkeletonLineProps: ComponentProps<typeof ChatLoaderSkeletonLine>;
  SkeletonProps: ComponentProps<typeof ChatLoaderSkeleton>;
  SpinnerProps: ComponentProps<typeof ChatLoaderSpinner>;
};
