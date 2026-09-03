/**
 * Platform-aware path helpers for the file manager. Windows agents use '\'
 * separators (drives, UNC shares); Linux agents use '/'. The helpers infer the
 * convention from the path itself so both platforms work without extra input.
 */

export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || /^[A-Za-z]:$/.test(p);
}

/** Separator used by the given path. */
export function pathSep(p: string): string {
  return isWindowsPath(p) ? '\\' : '/';
}

/** Join a directory and an entry name with the correct separator. */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const s = pathSep(dir);
  return dir.replace(/[\\/]+$/, '') + s + name;
}

/** Normalize a user-entered path: trim, unify separators, fix roots. */
export function normalizePath(input: string): string {
  let p = input.trim();
  if (!p) return p;

  const isUnc = p.startsWith('\\\\') || p.startsWith('//');
  if (isUnc) {
    // //host/share or \\host\share → \\host\share
    p = '\\\\' + p.replace(/^[\\/]+/, '').replace(/\//g, '\\');
  } else if (p.includes('\\') || /^[A-Za-z]:/.test(p)) {
    // Windows-style path: unify separators, strip trailing backslash.
    // Keep the drive-root backslash so "C:" navigates to the drive root.
    p = p.replace(/\//g, '\\').replace(/\\+$/, '');
  } else if (p.startsWith('/')) {
    // Unix-style path
    p = p.replace(/\/+$/, '');
  }

  if (/^[A-Za-z]:$/.test(p)) p += '\\';
  return p;
}

/** Parent of a path, aware of UNC roots, drive roots and Unix roots. */
export function getParentPath(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  if (!trimmed) return p;

  // UNC root: \\host or \\host\ → stay there
  if (trimmed.startsWith('\\\\')) {
    const parts = trimmed.slice(2).split('\\');
    if (parts.length <= 1) return '\\\\' + parts[0];
    return '\\\\' + parts.slice(0, -1).join('\\');
  }
  // Unix path
  if (trimmed.startsWith('/')) {
    const idx = trimmed.lastIndexOf('/');
    return idx <= 0 ? '/' : trimmed.slice(0, idx);
  }
  // Windows drive path
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + '\\';
  const idx = trimmed.lastIndexOf('\\');
  if (idx <= 1) return trimmed[0] + ':\\';
  return trimmed.slice(0, idx);
}

/** Compact label for the drive/root selector (C:\, /, \\host). */
export function driveLabel(p: string): string {
  if (p.startsWith('\\\\')) {
    const parts = p.slice(2).split('\\');
    return '\\\\' + (parts[0] || '');
  }
  if (/^[A-Za-z]:/.test(p)) return p.slice(0, 2).toUpperCase();
  if (p.startsWith('/')) return '/';
  return p;
}
