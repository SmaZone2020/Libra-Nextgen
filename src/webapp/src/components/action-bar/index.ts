import {
  ActionBarContent,
  ActionBarPrefix,
  ActionBarRoot,
  ActionBarSuffix,
} from './action-bar';
export type { ActionBarVariants } from './action-bar.styles';
export { actionBarVariants } from './action-bar.styles';

const ActionBar = Object.assign(ActionBarRoot, {
  Content: ActionBarContent,
  Prefix: ActionBarPrefix,
  Root: ActionBarRoot,
  Suffix: ActionBarSuffix,
});

export {
  ActionBar,
  ActionBarContent,
  ActionBarPrefix,
  ActionBarRoot,
  ActionBarSuffix,
};

export type {
  ActionBarContentProps,
  ActionBarPrefixProps,
  ActionBarRootProps as ActionBarProps,
  ActionBarRootProps,
  ActionBarSuffixProps,
} from './action-bar';
