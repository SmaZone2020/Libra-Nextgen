'use client';

import type { ComponentPropsWithRef, ReactNode, SVGProps } from 'react';
import { createContext, useContext, useId, useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { Button, Card, ProgressBar, Separator } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import { NumberValue } from '../number-value/index';
import { TrendChip } from '../trend-chip/index';
import { kpiVariants } from './kpi.styles';

interface KPIContextValue {
  slots?: ReturnType<typeof kpiVariants>;
}

const KPIContext = createContext<KPIContextValue>({});

const KPIDotsIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" viewBox="0 0 16 16" {...props}>
    <circle cx="8" cy="3" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="8" cy="13" r="1.5" />
  </svg>
);

interface KPIRootProps extends ComponentPropsWithRef<typeof Card> {
  children: ReactNode;
}

const KPIRoot = ({ children, className, ...props }: KPIRootProps) => {
  const slots = useMemo(() => kpiVariants(), []);

  return (
    <KPIContext.Provider value={{ slots }}>
      <Card
        className={composeSlotClassName(slots?.base, className)}
        data-slot="kpi"
        {...props}
      >
        {children}
      </Card>
    </KPIContext.Provider>
  );
};

interface KPIHeaderProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const KPIHeader = ({ children, className, ...props }: KPIHeaderProps) => {
  const { slots } = useContext(KPIContext);

  return (
    <div
      className={composeSlotClassName(slots?.header, className)}
      data-slot="kpi-header"
      {...props}
    >
      {children}
    </div>
  );
};

interface KPIContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const KPIContent = ({ children, className, ...props }: KPIContentProps) => {
  const { slots } = useContext(KPIContext);

  return (
    <div
      className={composeSlotClassName(slots?.content, className)}
      data-slot="kpi-content"
      {...props}
    >
      {children}
    </div>
  );
};

interface KPIIconProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Status color for icon background tinting. */
  status?: 'danger' | 'success' | 'warning';
}

const KPIIcon = ({ children, className, status, ...props }: KPIIconProps) => {
  const { slots } = useContext(KPIContext);

  return (
    <div
      className={composeSlotClassName(slots?.icon, className)}
      data-slot="kpi-icon"
      data-status={status}
      {...props}
    >
      {children}
    </div>
  );
};

interface KPITitleProps extends ComponentPropsWithRef<'dt'> {
  children: ReactNode;
}

const KPITitle = ({ children, className, ...props }: KPITitleProps) => {
  const { slots } = useContext(KPIContext);

  return (
    <dt
      className={composeSlotClassName(slots?.title, className)}
      data-slot="kpi-title"
      {...props}
    >
      {children}
    </dt>
  );
};

interface KPIValueProps extends Omit<
  ComponentPropsWithRef<typeof NumberValue>,
  'children'
> {
  children?: ComponentPropsWithRef<typeof NumberValue>['children'];
}

const KPIValue = ({ children, className, ...props }: KPIValueProps) => {
  const { slots } = useContext(KPIContext);

  return (
    <NumberValue {...props}>
      {(formatted) => (
        <dd
          className={composeSlotClassName(slots?.value, className)}
          data-slot="kpi-value"
        >
          {typeof children === 'function' ? children(formatted) : formatted}
        </dd>
      )}
    </NumberValue>
  );
};

interface KPITrendProps extends ComponentPropsWithRef<typeof TrendChip> {}

const KPITrend = ({ className, ...props }: KPITrendProps) => {
  const { slots } = useContext(KPIContext);

  return (
    <TrendChip
      className={composeSlotClassName(slots?.trend, className)}
      data-slot="kpi-trend"
      {...props}
    />
  );
};

interface KPIProgressProps extends ComponentPropsWithRef<'div'> {
  /** Status color for the progress bar. */
  status?: 'danger' | 'success' | 'warning';
  /** Progress value from 0 to 100. */
  value: number;
}

const KPIProgress = ({
  className,
  status = 'success',
  value,
  ...props
}: KPIProgressProps) => {
  const { slots } = useContext(KPIContext);
  const clampedValue = Math.max(0, Math.min(100, value));

  return (
    <div
      className={composeSlotClassName(slots?.progress, className)}
      data-slot="kpi-progress"
      {...props}
    >
      <ProgressBar
        aria-label="Progress"
        color={status}
        size="sm"
        value={clampedValue}
      >
        <ProgressBar.Track>
          <ProgressBar.Fill />
        </ProgressBar.Track>
      </ProgressBar>
    </div>
  );
};

interface KPIActionsProps extends ComponentPropsWithRef<typeof Button> {
  /** Custom icon to replace the default three-dot icon. */
  children?: ReactNode;
}

const KPIActions = ({ children, className, ...props }: KPIActionsProps) => {
  const { slots } = useContext(KPIContext);

  return (
    <div
      className={composeSlotClassName(slots?.actions)}
      data-slot="kpi-actions"
    >
      <Button
        isIconOnly
        className={className}
        size="sm"
        variant="ghost"
        {...props}
      >
        {children ?? <KPIDotsIcon className="size-4" />}
      </Button>
    </div>
  );
};

interface KPIChartProps extends ComponentPropsWithRef<'div'> {
  /** Stroke/line color. Defaults to currentColor. */
  color?: string;
  /** Chart data — array of objects with a numeric field matching `dataKey`. */
  data: Record<string, number | string>[];
  /** Key in each data object to use as the Y value. @default "value" */
  dataKey?: string;
  /** Fill color for the area gradient. Defaults to `color` at 20% opacity when not set. */
  fillColor?: string;
  /** Chart height in pixels. @default 80 */
  height?: number;
  /** Stroke width. @default 2 */
  strokeWidth?: number;
}

const KPIChart = ({
  className,
  color = 'currentColor',
  data,
  dataKey = 'value',
  fillColor,
  height = 80,
  strokeWidth = 2,
  ...props
}: KPIChartProps) => {
  const { slots } = useContext(KPIContext);
  const gradientId = `kpi-chart-gradient-${useId()}`;
  const resolvedFill = fillColor ?? color;

  return (
    <div
      className={composeSlotClassName(slots?.chart, className)}
      data-slot="kpi-chart"
      {...props}
    >
      <ResponsiveContainer height={height} width="100%">
        <AreaChart
          data={data}
          margin={{ bottom: 0, left: 0, right: 0, top: 4 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={resolvedFill} stopOpacity={0.2} />
              <stop offset="100%" stopColor={resolvedFill} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            dataKey={dataKey}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            stroke={color}
            strokeWidth={strokeWidth}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

interface KPISeparatorProps extends ComponentPropsWithRef<typeof Separator> {}

const KPISeparator = ({ className, ...props }: KPISeparatorProps) => {
  const { slots } = useContext(KPIContext);

  return (
    <Separator
      className={composeSlotClassName(slots?.separator, className)}
      data-slot="kpi-separator"
      {...props}
    />
  );
};

interface KPIFooterProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

const KPIFooter = ({ children, className, ...props }: KPIFooterProps) => {
  const { slots } = useContext(KPIContext);

  return (
    <div
      className={composeSlotClassName(slots?.footer, className)}
      data-slot="kpi-footer"
      {...props}
    >
      {children}
    </div>
  );
};

export {
  KPIActions,
  KPIChart,
  KPIContent,
  KPIFooter,
  KPIHeader,
  KPIIcon,
  KPIProgress,
  KPIRoot,
  KPISeparator,
  KPITitle,
  KPITrend,
  KPIValue,
};

export type {
  KPIActionsProps,
  KPIChartProps,
  KPIContentProps,
  KPIFooterProps,
  KPIHeaderProps,
  KPIIconProps,
  KPIProgressProps,
  KPIRootProps,
  KPISeparatorProps,
  KPITitleProps,
  KPITrendProps,
  KPIValueProps,
};
