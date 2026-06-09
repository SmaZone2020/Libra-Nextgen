'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import type { KPIGroupVariants } from './kpi-group.styles';
import { kpiGroupVariants } from './kpi-group.styles';

interface KPIGroupContextValue {
  slots?: ReturnType<typeof kpiGroupVariants>;
}

const KPIGroupContext = createContext<KPIGroupContextValue>({});

interface KPIGroupRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Layout direction. @default "horizontal" */
  orientation?: KPIGroupVariants['orientation'];
}

const KPIGroupRoot = ({
  children,
  className,
  orientation,
  ...props
}: KPIGroupRootProps) => {
  const slots = useMemo(() => kpiGroupVariants({ orientation }), [orientation]);

  return (
    <KPIGroupContext.Provider value={{ slots }}>
      <div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="kpi-group"
        role="group"
        {...props}
      >
        {children}
      </div>
    </KPIGroupContext.Provider>
  );
};

interface KPIGroupSeparatorProps extends ComponentPropsWithRef<'span'> {}

const KPIGroupSeparator = ({ className, ...props }: KPIGroupSeparatorProps) => {
  const { slots } = useContext(KPIGroupContext);

  return (
    <span
      aria-hidden="true"
      className={composeSlotClassName(slots?.separator, className)}
      data-slot="kpi-group-separator"
      {...props}
    />
  );
};

export { KPIGroupRoot, KPIGroupSeparator };
export type { KPIGroupRootProps, KPIGroupSeparatorProps };
