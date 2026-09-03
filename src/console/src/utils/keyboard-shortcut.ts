export interface ParsedShortcut {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  mod: boolean;
  shift: boolean;
}

export function parseToggleShortcut(shortcut: string): ParsedShortcut | null {
  const parts = shortcut
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) return null;

  const parsed: ParsedShortcut = {
    alt: false,
    ctrl: false,
    key: '',
    meta: false,
    mod: false,
    shift: false,
  };

  for (const part of parts) {
    if (part === 'mod') parsed.mod = true;
    else if (part === 'cmd' || part === 'command') parsed.meta = true;
    else if (part === 'ctrl' || part === 'control') parsed.ctrl = true;
    else if (part === 'meta' || part === 'win' || part === 'super')
      parsed.meta = true;
    else if (part === 'shift') parsed.shift = true;
    else if (part === 'alt' || part === 'option' || part === 'opt')
      parsed.alt = true;
    else parsed.key = part;
  }

  return parsed.key ? parsed : null;
}

export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: ParsedShortcut
): boolean {
  return (
    event.key.toLowerCase() === shortcut.key &&
    shortcut.shift === event.shiftKey &&
    shortcut.alt === event.altKey &&
    (shortcut.mod
      ? !(!event.metaKey && !event.ctrlKey)
      : shortcut.ctrl === event.ctrlKey && shortcut.meta === event.metaKey)
  );
}
