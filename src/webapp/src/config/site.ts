import { ChartLine, Cpu, Display, Folder, ListTimeline, Terminal } from "@gravity-ui/icons";

export const siteConfig = {
  name: 'Libra-Nextgen',
  description: 'C2 Framework Console',
};


export const pageMeta: Record<string, { label: string; subtitle: string }> = {
  '/': { label: 'Dashboard', subtitle: 'Overview' },
  '/agents': { label: 'Agents', subtitle: 'Agent list' },
  '/shell': { label: 'Shell', subtitle: 'Remote terminal' },
  '/files': { label: 'File Manager', subtitle: 'File browser' },
  '/system': { label: 'System', subtitle: 'Remote system info' },
  '/audit': { label: 'Audit Logs', subtitle: 'Security audit trail' },
};


export const sidebarItems = [
  { icon: ChartLine, to: '/', label: 'Dashboard' },
  { icon: Display, to: '/agents', label: 'Agents' },
  { icon: Terminal, to: '/shell', label: 'Shell' },
  { icon: Folder, to: '/files', label: 'File Manager' },
  { icon: Cpu, to: '/system', label: 'System' },
  { icon: ListTimeline, to: '/audit', label: 'Audit Logs' },
];