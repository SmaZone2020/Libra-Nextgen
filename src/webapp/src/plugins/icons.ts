import type { ComponentType, SVGProps } from 'react';
import {
  Cpu,
  Globe,
  Folder,
  Terminal,
  Camera,
  Bug,
  PlugConnection,
  Puzzle,
  Shield,
  Server,
  Magnifier,
  Rocket,
  Comments,
} from '@gravity-ui/icons';

/**
 * Whitelisted icon name → component map for plugin manifests.
 *
 * Plugin `entry.icon` carries a string NAME (never a component), which the
 * shell maps through this allowlist. This prevents a plugin from importing an
 * arbitrary module — only the icons declared here are usable.
 */
export const PLUGIN_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  Cpu,
  Globe,
  Folder,
  Terminal,
  Camera,
  Bug,
  PlugConnection,
  Puzzle,
  Shield,
  Server,
  Magnifier,
  Rocket,
  Comments,
};

/** Resolve an icon name to a component, falling back to Puzzle. */
export function resolvePluginIcon(name?: string): ComponentType<SVGProps<SVGSVGElement>> {
  if (!name) return Puzzle;
  return PLUGIN_ICONS[name] ?? Puzzle;
}
