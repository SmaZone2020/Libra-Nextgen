'use client';

import { resolveModelIcon } from './modelIcons';

export function BrandIcon({ name, className = 'size-5' }: { name: string; className?: string }) {
  const icon = name ? resolveModelIcon(name) : null;
  if (icon) {
    return (
      <img src={icon} alt="" className={`${className} rounded-[15px] shrink-0 object-contain`} loading="lazy" />
    );
  }
  return (
    <img
      alt="icon"
      className={`${className} shrink-0 object-cover dark:invert select-none pointer-events-none`}
      loading="lazy"
      src="/images/icon2.webp"
    />
  );
}
