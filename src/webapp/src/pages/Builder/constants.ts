import type { BuildConfigRequest } from '../../types/models';

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
};

export const STATUS_LABEL: Record<string, string> = {
  building: 'builder.buildingStatus',
  completed: 'builder.completed',
  failed: 'builder.failed',
};

export const PLATFORM_LABEL: Record<string, string> = {
  x64: 'Win x64',
  x86: 'Win x86',
};

export const APP_TYPE_LABEL: Record<string, string> = {
  Console: 'builder.consoleApp',
  Desktop: 'builder.desktopApp',
};
