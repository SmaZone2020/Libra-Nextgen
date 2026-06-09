import {
  ResizableHandle,
  ResizableIndicator,
  ResizablePanel,
  ResizableRoot,
} from './resizable';
export { ResizableContext, useResizableContext } from './resizable';
export { resizableVariants } from './resizable.styles';

const Resizable = Object.assign(ResizableRoot, {
  Handle: ResizableHandle,
  Indicator: ResizableIndicator,
  Panel: ResizablePanel,
  Root: ResizableRoot,
});

export {
  Resizable,
  ResizableHandle,
  ResizableIndicator,
  ResizablePanel,
  ResizableRoot,
};
export type {
  ResizableHandleProps,
  ResizableIndicatorProps,
  ResizablePanelProps,
  ResizableRootProps as ResizableProps,
  ResizableRootProps,
} from './resizable';
export type { ResizableContextValue } from './resizable';
export type { ResizableVariants } from './resizable.styles';
export type {
  GroupImperativeHandle,
  Layout,
  LayoutStorage,
  PanelImperativeHandle,
  PanelSize,
} from 'react-resizable-panels';
