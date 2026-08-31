import type { ComponentType, SVGProps } from 'react';
import {
  ArrowDownToLine,
  ArrowRotateLeft,
  Bug,
  Camera,
  ChevronDown,
  Comments,
  Cpu,
  Eye,
  EyeSlash,
  File,
  FileCode,
  FileLetterP,
  FileLetterW,
  FileLetterX,
  FileText,
  FileZipper,
  Folder,
  Globe,
  Magnifier,
  MusicNote,
  Picture,
  PlugConnection,
  Puzzle,
  Rocket,
  Server,
  Shield,
  Terminal,
  Video,
} from '@gravity-ui/icons';

/**
 * Whitelisted icon name → component map exposed to plugin pages via
 * `window.LibraPluginHost.Icons`.
 *
 * Plugin `entry.icon` carries a string NAME (never a component), and compiled
 * plugin bundles import icons from `@gravity-ui/icons`, which the pack step
 * externalizes onto this same allowlist. This prevents a plugin from pulling an
 * arbitrary icon — only the icons declared here are usable at runtime.
 *
 * To grant plugins a new icon: add it to the import list AND to PLUGIN_ICONS.
 */
export const PLUGIN_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  ArrowDownToLine,
  ArrowRotateLeft,
  Bug,
  Camera,
  ChevronDown,
  Comments,
  Cpu,
  Eye,
  EyeSlash,
  File,
  FileCode,
  FileLetterP,
  FileLetterW,
  FileLetterX,
  FileText,
  FileZipper,
  Folder,
  Globe,
  Magnifier,
  MusicNote,
  Picture,
  PlugConnection,
  Puzzle,
  Rocket,
  Server,
  Shield,
  Terminal,
  Video,
};

/** Resolve an icon name to a component, falling back to Puzzle. */
export function resolvePluginIcon(name?: string): ComponentType<SVGProps<SVGSVGElement>> {
  if (!name) return Puzzle;
  return PLUGIN_ICONS[name] ?? Puzzle;
}
