import type { ComponentProps } from 'react';
import {
  CellSliderFill,
  CellSliderLabel,
  CellSliderOutput,
  CellSliderRoot,
  CellSliderThumb,
  CellSliderTrack,
} from './cell-slider';
export { cellSliderVariants } from './cell-slider.styles';

export const CellSlider = Object.assign(CellSliderRoot, {
  Fill: CellSliderFill,
  Label: CellSliderLabel,
  Output: CellSliderOutput,
  Root: CellSliderRoot,
  Thumb: CellSliderThumb,
  Track: CellSliderTrack,
});

export {
  CellSliderFill,
  CellSliderLabel,
  CellSliderOutput,
  CellSliderRoot,
  CellSliderThumb,
  CellSliderTrack,
};

export type {
  CellSliderFillProps,
  CellSliderLabelProps,
  CellSliderOutputProps,
  CellSliderRootProps as CellSliderProps,
  CellSliderRootProps,
  CellSliderThumbProps,
  CellSliderTrackProps,
} from './cell-slider';
export type { CellSliderVariants } from './cell-slider.styles';

export type CellSlider = {
  FillProps: ComponentProps<typeof CellSliderFill>;
  LabelProps: ComponentProps<typeof CellSliderLabel>;
  OutputProps: ComponentProps<typeof CellSliderOutput>;
  Props: ComponentProps<typeof CellSliderRoot>;
  RootProps: ComponentProps<typeof CellSliderRoot>;
  ThumbProps: ComponentProps<typeof CellSliderThumb>;
  TrackProps: ComponentProps<typeof CellSliderTrack>;
};
