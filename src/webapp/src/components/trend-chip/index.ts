import {
  TrendChipIndicator,
  TrendChipPrefix,
  TrendChipRoot,
  TrendChipSuffix,
} from './trend-chip';
export { trendChipVariants } from './trend-chip.styles';

const TrendChip = Object.assign(TrendChipRoot, {
  Indicator: TrendChipIndicator,
  Prefix: TrendChipPrefix,
  Root: TrendChipRoot,
  Suffix: TrendChipSuffix,
});

export {
  TrendChip,
  TrendChipIndicator,
  TrendChipPrefix,
  TrendChipRoot,
  TrendChipSuffix,
};

export type {
  TrendChipIndicatorProps,
  TrendChipPrefixProps,
  TrendChipRootProps as TrendChipProps,
  TrendChipRootProps,
  TrendChipSuffixProps,
} from './trend-chip';
export type { TrendChipVariants } from './trend-chip.styles';
