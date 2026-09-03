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
 * Whitelisted icon name → component map for the console sidebar.
 *
 * Plugin `entry.icon` carries a string NAME (never a component), which the
 * shell maps through this allowlist for the sidebar/route icons. Plugin pages
 * themselves are plain HTML (no icon imports) — this map only affects console
 * chrome, so it must keep matching the icon names plugins declare in meta.json.
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
