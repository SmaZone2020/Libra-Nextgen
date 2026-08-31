import { ChartLine, Cpu, Display, Folder, Globe, Shield, Terminal, PlugConnection, Code, CircleInfo, Gear, Puzzle, Layers, Sparkles } from "@gravity-ui/icons";
import type { NavItem } from "../shared/layout/Sidebar";

export const siteConfig = {
  name: 'Libra-Nextgen',
  description: 'C2 Framework Console',
};

// Top-level leaf items (always visible).
const topLevelItems: NavItem[] = [
  { icon: ChartLine, to: '/', label: 'nav.dashboard' },
  { icon: Display, to: '/agents', label: 'nav.agents' },
  { icon: Sparkles, to: '/ai', label: "nav.ai"}

];

const featuresGroup: NavItem = {
  icon: Layers,
  to: '',
  label: 'nav.features',
  children: [
    { icon: Terminal, to: '/shell', label: 'nav.shell' },
    { icon: Folder, to: '/files', label: 'nav.explorer' },
    { icon: PlugConnection, to: '/othersoft', label: 'nav.softwareData' },
    { icon: Globe, to: '/proxy', label: 'nav.proxyBrowser' },
    { icon: Cpu, to: '/system', label: 'nav.system' },
  ],
};

// More top-level leaves after the features group.
const bottomTopItems: NavItem[] = [
  { icon: Code, to: '/builder', label: 'nav.builder' },
  { icon: Shield, to: '/audit', label: 'nav.auditLogs' },
];

const pluginManagerGroup: NavItem = {
  icon: Puzzle,
  to: '/plugins',
  label: 'nav.pluginManager',
  children: [],
};

export const sidebarItems: NavItem[] = [
  ...topLevelItems,
  featuresGroup,
  pluginManagerGroup,
  ...bottomTopItems,
];

export const sidebarBottomItems: NavItem[] = [
  { icon: Gear, to: '/settings', label: 'nav.settings' },
  { icon: CircleInfo, to: '/about', label: 'nav.about' },
];
