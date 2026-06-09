import {
  CellSelectIndicator,
  CellSelectLabel,
  CellSelectPopover,
  CellSelectRoot,
  CellSelectTrigger,
  CellSelectValue,
} from './cell-select';
export { cellSelectVariants } from './cell-select.styles';

export const CellSelect = Object.assign(CellSelectRoot, {
  Indicator: CellSelectIndicator,
  Label: CellSelectLabel,
  Popover: CellSelectPopover,
  Root: CellSelectRoot,
  Trigger: CellSelectTrigger,
  Value: CellSelectValue,
});

export {
  CellSelectIndicator,
  CellSelectLabel,
  CellSelectPopover,
  CellSelectRoot,
  CellSelectTrigger,
  CellSelectValue,
};
