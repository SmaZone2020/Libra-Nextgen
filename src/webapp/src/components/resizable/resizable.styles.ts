import { tv, type VariantProps } from 'tailwind-variants';

const resizableVariants = tv({
  defaultVariants: {
    orientation: 'horizontal',
    type: 'line',
    variant: 'primary',
  },
  slots: {
    base: 'resizable',
    handle: 'resizable__handle',
    handleBar: 'resizable__handle-bar',
    handleHitArea: 'resizable__handle-hit-area',
    indicator: 'resizable__handle-indicator',
    panel: 'resizable__panel',
  },
  variants: {
    orientation: {
      horizontal: {
        base: 'resizable--horizontal',
        handle: 'resizable__handle--horizontal',
        handleBar: 'resizable__handle-bar--horizontal',
        handleHitArea: 'resizable__handle-hit-area--horizontal',
      },
      vertical: {
        base: 'resizable--vertical',
        handle: 'resizable__handle--vertical',
        handleBar: 'resizable__handle-bar--vertical',
        handleHitArea: 'resizable__handle-hit-area--vertical',
      },
    },
    type: {
      drag: {
        handle: 'resizable__handle--drag',
        indicator: 'resizable__handle-indicator--drag',
      },
      handle: {
        handle: 'resizable__handle--handle',
        indicator: 'resizable__handle-indicator--pill',
      },
      line: {
        handle: 'resizable__handle--line',
      },
      pill: {
        handle: 'resizable__handle--pill',
        indicator: 'resizable__handle-indicator--pill',
      },
    },
    variant: {
      primary: {
        handle: 'resizable__handle--primary',
      },
      secondary: {
        handle: 'resizable__handle--secondary',
      },
      tertiary: {
        handle: 'resizable__handle--tertiary',
      },
    },
  },
});

export type ResizableVariants = VariantProps<typeof resizableVariants>;
export { resizableVariants };
