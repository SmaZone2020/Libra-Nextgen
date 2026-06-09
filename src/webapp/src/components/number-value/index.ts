import {
  NumberValuePrefix,
  NumberValueRoot,
  NumberValueSuffix,
} from './number-value';

export { numberValueVariants } from './number-value.styles';

const NumberValue = Object.assign(NumberValueRoot, {
  Prefix: NumberValuePrefix,
  Root: NumberValueRoot,
  Suffix: NumberValueSuffix,
});

export { NumberValue, NumberValuePrefix, NumberValueRoot, NumberValueSuffix };

export type {
  NumberValuePrefixProps,
  NumberValueRootProps as NumberValueProps,
  NumberValueRootProps,
  NumberValueSuffixProps,
} from './number-value';
export type { NumberValueVariants } from './number-value.styles';
