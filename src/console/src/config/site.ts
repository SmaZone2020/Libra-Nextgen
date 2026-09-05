import { ChartLine, Cpu, Display, Folder, Globe, Shield, Terminal, PlugConnection, Code, CircleInfo, Gear, Puzzle, Sparkles } from "@gravity-ui/icons";
import type { NavItem, SidebarSection } from "../shared/layout/Sidebar";

export const siteConfig = {
  name: 'Libra-Nextgen',
  description: 'C2 Framework Console',
};

/**
 * Workspace-style navigation, split into quiet sections:
 *  - an unlabeled primary block (overview / agents / AI) at the top
 *  - captioned tool sections below, mirroring a desktop workbench
 *
 * Only the plugin-manager entry keeps dynamic children (installed plugin
 * pages); every other tool is a flat leaf so the rail stays light.
 */
export const sidebarSections: SidebarSection[] = [
  // Primary block — no caption.
  {
    items: [
      { icon: ChartLine, to: '/', label: 'nav.dashboard' },
      { icon: Display, to: '/agents', label: 'nav.agents' },
      { icon: Sparkles, to: '/ai', label: 'nav.ai' },
    ],
  },
  // Tool functions live here: shell / files / data / proxy / system / builder.
  {
    captionKey: 'nav.section.workspace',
    items: [
      { icon: Terminal, to: '/shell', label: 'nav.shell' },
      { icon: Folder, to: '/files', label: 'nav.explorer' },
      { icon: PlugConnection, to: '/othersoft', label: 'nav.softwareData' },
      { icon: Globe, to: '/proxy', label: 'nav.proxyBrowser' },
      { icon: Cpu, to: '/system', label: 'nav.system' },
      { icon: Code, to: '/builder', label: 'nav.builder' },
    ],
  },
  // Operational area: plugin manager (dynamic children) and audit trail.
  {
    captionKey: 'nav.section.operations',
    items: [
      { icon: Puzzle, to: '/plugins', label: 'nav.pluginManager', children: [] },
      { icon: Shield, to: '/audit', label: 'nav.auditLogs' },
    ],
  },
];

/**
 * Settings / About — rendered as a fixed footer block above the user card,
 * OUTSIDE the scrollable navigation rail (they never scroll with sections).
 */
export const sidebarFootItems: NavItem[] = [
  { icon: Gear, to: '/settings', label: 'nav.settings' },
  { icon: CircleInfo, to: '/about', label: 'nav.about' },
];
