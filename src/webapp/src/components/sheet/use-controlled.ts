'use client';

import * as React from 'react';

export interface UseControlledProps<T = unknown> {
  controlled: T | undefined;
  default: T | undefined;
  onChange?: (newValue: T | ((prevValue: T) => T)) => void;
}

export function useControlled<T = unknown>({
  controlled,
  default: defaultProp,
  onChange,
}: UseControlledProps<T>): [T, (newValue: T | ((prevValue: T) => T)) => void] {
  const { current: isControlled } = React.useRef(controlled !== undefined);
  const [internalValue, setInternalValue] = React.useState<T | undefined>(
    defaultProp
  );
  const value = isControlled ? controlled : internalValue;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const setValue = React.useCallback((newValue: T | ((prevValue: T) => T)) => {
    if (!isControlled) {
      setInternalValue(newValue as T);
    }
    onChangeRef.current?.(newValue);
  }, []);

  return [value as T, setValue];
}
