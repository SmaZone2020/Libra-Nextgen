import { ChartLine, Cpu, Display, DisplayPulse, Folder, Globe, ListTimeline, Camera, Terminal, PlugConnection } from "@gravity-ui/icons";

export const siteConfig = {
  name: 'Libra-Nextgen',
  description: 'C2 Framework Console',
};

export const sidebarItems = [
  { icon: ChartLine, to: '/', label: 'nav.dashboard' },
  { icon: Display, to: '/agents', label: 'nav.agents' },
  { icon: DisplayPulse, to: '/screen', label: 'nav.screen' },
  { icon: Camera, to: '/media', label: 'nav.media' },
  { icon: Terminal, to: '/shell', label: 'nav.shell' },
  { icon: Folder, to: '/files', label: 'nav.explorer' },
  { icon: PlugConnection, to: '/othersoft', label: 'nav.otherSoftware' },
  { icon: Globe, to: '/proxy', label: 'nav.proxyBrowser' },
  { icon: Cpu, to: '/system', label: 'nav.system' },
  { icon: ListTimeline, to: '/audit', label: 'nav.auditLogs' },
];