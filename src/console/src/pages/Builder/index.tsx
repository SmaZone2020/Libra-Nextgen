import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addBuildListItem,
  buildModules,
  deleteBuild,
  deleteBuildListItem,
  deleteTemplate,
  getBuildInfo,
  getBuildLists,
  getBuildStreamUrl,
  listBuilds,
  listModules,
  listTemplates,
  startBuild,
  toggleBuildListItem,
  toggleModule,
  uploadTemplate,
} from '../../api/build';
import type { TrafficListName } from '../../api/build';
import type { BuildTrafficLists } from '../../api/build';
import type { BuildConfigRequest, BuildRecord, BuildRecordDetail, TemplateInfo } from '../../types/models';
import type { ModuleEntry } from '../../api/build';
import { BuilderConfigCard } from './BuilderConfigCard';
import { BuilderConnectionCard } from './BuilderConnectionCard';
import { BuilderDownloadModal } from './BuilderDownloadModal';
import { BuilderHistoryPanel } from './BuilderHistoryPanel';
import { BuilderMetadataCard } from './BuilderMetadataCard';
import { BuilderModals } from './BuilderModals';
import { BuilderOptionsCard } from './BuilderOptionsCard';
import { BuilderPlatformCard } from './BuilderPlatformCard';
import { BuilderTrafficCard } from './BuilderTrafficCard';
import { saveBuildPreset } from '../../utils/buildPresets';
import { DEFAULT_CONFIG } from './constants';

export default function BuilderPage() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<BuildConfigRequest>({ ...DEFAULT_CONFIG });
  const [building, setBuilding] = useState(false);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);
  const [buildSucceeded, setBuildSucceeded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBuildResultRef = useRef<string | null>(null);
  const finalConfigRef = useRef<BuildConfigRequest | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // History
  const [history, setHistory] = useState<BuildRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<BuildRecordDetail | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [downloadRecord, setDownloadRecord] = useState<BuildRecordDetail | null>(null);

  // Templates
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateUploading, setTemplateUploading] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);

  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [modulesBuilding, setModulesBuilding] = useState(false);

  const activeModules = () => modules.filter(m => m.enabled).map(m => m.name);

  const loadModules = useCallback(async () => {
    try {
      setModulesLoading(true);
      const items = await listModules(config.platform);
      setModules(items);
    } catch { /* ignore */ } finally {
      setModulesLoading(false);
    }
  }, [config.platform]);

  useEffect(() => { loadModules(); }, [loadModules]);

  const handleToggleModule = async (name: string, enabled: boolean) => {
    const prev = modules;
    setModules(prev.map(m => (m.name === name ? { ...m, enabled } : m)));
    try {
      await toggleModule(config.platform, name, enabled);
    } catch {
      setModules(prev);
    }
  };

  const [trafficLists, setTrafficLists] = useState<BuildTrafficLists | null>(null);

  const loadTrafficLists = useCallback(async () => {
    try {
      const items = await getBuildLists();
      setTrafficLists(items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadTrafficLists(); }, [loadTrafficLists]);

  const handleAddTrafficItem = async (list: TrafficListName, value: string) => {
    const updated = await addBuildListItem(list, value);
    setTrafficLists(updated);
  };

  const handleToggleTrafficItem = async (list: TrafficListName, id: string, enabled: boolean) => {
    setTrafficLists(prev => prev ? ({
      ...prev,
      [list]: prev[list].map(i => (i.id === id ? { ...i, enabled } : i)),
    }) : prev);
    try {
      const updated = await toggleBuildListItem(list, id, enabled);
      setTrafficLists(updated);
    } catch {  }
  };

  const handleDeleteTrafficItem = async (list: TrafficListName, id: string) => {
    const updated = await deleteBuildListItem(list, id);
    setTrafficLists(updated);
  };

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

  const applyConfig = (next: BuildConfigRequest) => setConfig(next);

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
      const finalConfig: BuildConfigRequest = {
        ...config,
        userAgents: (trafficLists?.userAgents ?? []).filter(i => i.enabled).map(i => i.value),
        extraHeaders: (trafficLists?.extraHeaders ?? []).filter(i => i.enabled).map(i => i.value),
        pathSuffixes: (trafficLists?.pathSuffixes ?? []).filter(i => i.enabled).map(i => i.value),
        enabledModules: activeModules(),
      };
      finalConfigRef.current = finalConfig;
      const id = await startBuild(finalConfig);
      streamBuild(id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBuilding(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  };

  const streamBuild = (id: string) => {
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
              saveBuildPreset(finalConfigRef.current ?? config);
            }
            setBuilding(false);
            setModulesBuilding(false);
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            loadHistory();
            break;
          case 'error':
            setError(msg.message || 'Stream error');
            es.close();
            esRef.current = null;
            setBuilding(false);
            setModulesBuilding(false);
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            break;
        }
      } catch { /* parse error */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setBuilding(false);
      setModulesBuilding(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (logs.length === 0) {
        setError('Failed to connect to build log stream.');
      }
    };
  };

  const handleBuildModules = async () => {
    setModulesBuilding(true);
    setBuilding(true);
    setError(null);
    setLogs([]);
    setElapsed(0);
    setBuildStatus('builder.preparing');
    setBuildSucceeded(false);
    lastBuildResultRef.current = null;

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 200);

    try {
      const id = await buildModules(config.platform, activeModules());
      streamBuild(id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBuilding(false);
      setModulesBuilding(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  };

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

  const handleDownload = async (id: string) => {
    try {
      const detail = await getBuildInfo(id);
      setDownloadRecord(detail);
    } catch { /* ignore */ }
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

  const handleUploadTemplate = async (file: File) => {
    setTemplateUploading(true);
    try {
      await uploadTemplate(file, config.platform);
      await loadTemplates();
    } catch { /* ignore */ } finally {
      setTemplateUploading(false);
    }
  };

  const confirmDeleteTemplate = async () => {
    if (!templateToDelete) return;
    const platform = templateToDelete;
    setTemplateToDelete(null);
    try {
      await deleteTemplate(platform);
      await loadTemplates();
    } catch { /* ignore */ }
  };

  const handleRebuildFromTemplate = (platform: string) => {
    setConfig((c) => ({ ...c, platform }));
    setTimeout(() => handleBuild(), 0);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 max-w-6xl mx-auto items-start w-full">
      {/* Left: Build Config */}
      <div className="flex-1 space-y-4">
        <BuilderConfigCard config={config} set={set} applyConfig={applyConfig} />
        <BuilderPlatformCard config={config} set={set} />
        <BuilderMetadataCard config={config} set={set} />
        <BuilderConnectionCard config={config} set={set} />
        <BuilderOptionsCard config={config} set={set} />
        <BuilderTrafficCard
          lists={trafficLists}
          onAddItem={handleAddTrafficItem}
          onToggleItem={handleToggleTrafficItem}
          onDeleteItem={handleDeleteTrafficItem}
        />
      </div>

      {/* Right: Build History */}
      <div className="w-full lg:w-72 shrink-0">
        <BuilderHistoryPanel
          building={building}
          buildStatus={buildStatus}
          error={error}
          history={history}
          templates={templates}
          historyLoading={historyLoading}
          templateUploading={templateUploading}
          enabledModules={modules}
          modulesLoading={modulesLoading}
          modulesBuilding={modulesBuilding}
          onBuild={handleBuild}
          onBuildModules={handleBuildModules}
          onToggleModule={handleToggleModule}
          onOpenInfo={handleOpenInfo}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onDeleteTemplate={setTemplateToDelete}
          onRebuildFromTemplate={handleRebuildFromTemplate}
          onUploadTemplate={handleUploadTemplate}
        />
      </div>

      {/* Modals */}
      <BuilderModals
        building={building}
        buildSucceeded={buildSucceeded}
        logs={logs}
        elapsed={elapsed}
        buildId={buildId}
        templateToDelete={templateToDelete}
        selectedRecord={selectedRecord}
        infoLoading={infoLoading}
        onCloseLogs={() => { setLogs([]); setBuildSucceeded(false); }}
        onDownload={handleDownload}
        onConfirmDeleteTemplate={confirmDeleteTemplate}
        onCancelDeleteTemplate={() => setTemplateToDelete(null)}
        onCloseInfo={() => setSelectedRecord(null)}
      />

      <BuilderDownloadModal
        record={downloadRecord}
        onClose={() => setDownloadRecord(null)}
      />
    </div>
  );
}
