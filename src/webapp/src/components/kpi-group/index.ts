import type { ComponentProps } from 'react';
import { KPIGroupRoot, KPIGroupSeparator } from './kpi-group';

export { kpiGroupVariants } from './kpi-group.styles';

const KPIGroup = Object.assign(KPIGroupRoot, {
  Root: KPIGroupRoot,
  Separator: KPIGroupSeparator,
});

export { KPIGroup, KPIGroupRoot, KPIGroupSeparator };

export type {
  KPIGroupRootProps as KPIGroupProps,
  KPIGroupRootProps,
  KPIGroupSeparatorProps,
} from './kpi-group';
export type { KPIGroupVariants } from './kpi-group.styles';

export type KPIGroup = {
  Props: ComponentProps<typeof KPIGroupRoot>;
  RootProps: ComponentProps<typeof KPIGroupRoot>;
  SeparatorProps: ComponentProps<typeof KPIGroupSeparator>;
};
