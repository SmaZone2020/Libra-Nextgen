import {
  FloatingTocBar,
  FloatingTocContent,
  FloatingTocItem,
  FloatingTocRoot,
  FloatingTocTrigger,
} from './floating-toc';

export { floatingTocVariants } from './floating-toc.styles';

export const FloatingToc = Object.assign(FloatingTocRoot, {
  Bar: FloatingTocBar,
  Content: FloatingTocContent,
  Item: FloatingTocItem,
  Root: FloatingTocRoot,
  Trigger: FloatingTocTrigger,
});

export {
  FloatingTocBar,
  FloatingTocContent,
  FloatingTocItem,
  FloatingTocRoot,
  FloatingTocTrigger,
};

export type {
  FloatingTocBarProps,
  FloatingTocContentProps,
  FloatingTocItemProps,
  FloatingTocRootProps as FloatingTocProps,
  FloatingTocRootProps,
  FloatingTocTriggerProps,
} from './floating-toc';
export type { FloatingTocVariants } from './floating-toc.styles';
export { floatingTocVariants as default } from './floating-toc.styles';
