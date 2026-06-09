import type { ComponentProps } from 'react';
import {
  AppLayoutAsideTrigger,
  AppLayoutMenuToggle,
  AppLayoutMobileAside,
  AppLayoutRoot,
} from './app-layout';

export { AppLayoutContext, useAppLayout } from './app-layout';
export { appLayoutVariants } from './app-layout.styles';

export const AppLayout = Object.assign(AppLayoutRoot, {
  AsideTrigger: AppLayoutAsideTrigger,
  MenuToggle: AppLayoutMenuToggle,
  MobileAside: AppLayoutMobileAside,
  Root: AppLayoutRoot,
});

export type AppLayout = {
  AsideTriggerProps: ComponentProps<typeof AppLayoutAsideTrigger>;
  MenuToggleProps: ComponentProps<typeof AppLayoutMenuToggle>;
  MobileAsideProps: ComponentProps<typeof AppLayoutMobileAside>;
  Props: ComponentProps<typeof AppLayoutRoot>;
  RootProps: ComponentProps<typeof AppLayoutRoot>;
};

export {
  AppLayoutAsideTrigger,
  AppLayoutMenuToggle,
  AppLayoutMobileAside,
  AppLayoutRoot,
};

export type {
  AppLayoutAsideTriggerProps,
  AppLayoutContextValue,
  AppLayoutMenuToggleProps,
  AppLayoutMobileAsideProps,
  AppLayoutRootProps as AppLayoutProps,
  AppLayoutRootProps,
  AppLayoutScrollMode,
  AppLayoutTooltipProps,
} from './app-layout';
export type { AppLayoutVariants } from './app-layout.styles';
