import {
  CellSwitchControl,
  CellSwitchLabel,
  CellSwitchRoot,
  CellSwitchTrigger,
} from './cell-switch';
export { cellSwitchVariants } from './cell-switch.styles';

export const CellSwitch = Object.assign(CellSwitchRoot, {
  Control: CellSwitchControl,
  Label: CellSwitchLabel,
  Root: CellSwitchRoot,
  Trigger: CellSwitchTrigger,
});

export {
  CellSwitchControl,
  CellSwitchLabel,
  CellSwitchRoot,
  CellSwitchTrigger,
};
