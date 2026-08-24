import { ChartLine, Cpu, Display, DisplayPulse, Folder, Globe, ListTimeline, Camera, Terminal, PlugConnection, Code, CircleInfo, Gear, Puzzle, Layers } from "@gravity-ui/icons";
import type { NavItem } from "../shared/layout/Sidebar";

export const siteConfig = {
  name: 'Libra-Nextgen',
  description: 'C2 Framework Console',
};

// Top-level leaf items (always visible).
const topLevelItems: NavItem[] = [
  { icon: ChartLine, to: '/', label: 'nav.dashboard' },
  { icon: Display, to: '/agents', label: 'nav.agents' },
];

// "功能" 母项：收纳所有功能类页面（文件/摄像头/软件数据等）。
const featuresGroup: NavItem = {
  icon: Layers,
  to: '',
  label: 'nav.features',
  children: [
    { icon: DisplayPulse, to: '/screen', label: 'nav.screen' },
    { icon: Camera, to: '/media', label: 'nav.media' },
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
  { icon: ListTimeline, to: '/audit', label: 'nav.auditLogs' },
];

// "插件管理" 母项：单击跳转 /plugins，下拉展开 enabled 插件页面列表
// （children 由 App.tsx 从 enabled 插件动态填充）。
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
