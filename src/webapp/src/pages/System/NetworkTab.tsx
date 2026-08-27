import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@heroui/react';
import { Magnifier } from '@gravity-ui/icons';
import { getNetworkWan, getNetworkWifi, getNetworkNearby, getNetworkProxy, startLanScan, getLanScanTask, parseLanScanResult } from '../../api/system';
import { DataGrid } from '../../components/data-grid';
import type { DataGridColumn } from '../../components/data-grid';
import type { WifiProfile, NearbyWifiNetwork, LanDevice } from '../../types/models';

interface NetworkTabProps {
  agentId: string;
}

interface WanInfo {
  publicIp?: string;
  gateway?: string;
  region?: string;
  isp?: string;
  llc?: string;
  asn?: string;
  latitude?: number;
  longitude?: number;
}

interface ProxyInfo {
  enabled?: boolean;
  server?: string;
}

export function NetworkTab({ agentId }: NetworkTabProps) {
  const { t } = useTranslation();

  // Independent loading states
  const [wan, setWan] = useState<WanInfo | null>(null);
  const [wanLoading, setWanLoading] = useState(true);

  const [wifi, setWifi] = useState<WifiProfile[] | null>(null);
  const [wifiLoading, setWifiLoading] = useState(true);

  const [nearbyWifi, setNearbyWifi] = useState<NearbyWifiNetwork[] | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(true);

  const [proxy, setProxy] = useState<ProxyInfo | null>(null);
  const [dnsSuffix, setDnsSuffix] = useState('');
  const [proxyLoading, setProxyLoading] = useState(true);

  // LAN scan state (task-based polling; a /24 sweep takes seconds to minutes)
  const [lanDevices, setLanDevices] = useState<LanDevice[] | null>(null);
  const [lanSubnets, setLanSubnets] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskIdRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Clear the timer on unmount.
  useEffect(() => stopPolling, [stopPolling]);

  const handleScan = useCallback(async () => {
    stopPolling();
    setScanning(true);
    setScanError(null);
    setLanDevices(null);
    setLanSubnets([]);
    try {
      const { taskId } = await startLanScan(agentId);
      taskIdRef.current = taskId;
      // LAN scans are long-running: poll every 2s instead of blocking on a
      // single synchronous relay request that would hit proxy/browser timeouts.
      pollTimerRef.current = setInterval(async () => {
        try {
          const task = await getLanScanTask(taskId);
          if (task.status === 'Completed') {
            const parsed = parseLanScanResult(task);
            if (parsed) {
              setLanDevices(parsed.devices);
              setLanSubnets(parsed.subnets);
            } else {
              setScanError(t('system.scanBadResult'));
            }
            stopPolling();
            setScanning(false);
          } else if (task.status === 'Failed' || task.status === 'Cancelled') {
            setScanError(task.error || t('system.scanFailed'));
            stopPolling();
            setScanning(false);
          }
        } catch {
          // Transient network error — keep polling until the task resolves.
        }
      }, 2000);
    } catch {
      setScanError(t('system.scanStartFailed'));
      setScanning(false);
    }
  }, [agentId, stopPolling, t]);

  const fetchWan = useCallback(async () => {
    try {
      const res = await getNetworkWan(agentId);
      setWan(res.wan ?? null);
    } catch { /* ignore */ }
    finally { setWanLoading(false); }
  }, [agentId]);

  const fetchWifi = useCallback(async () => {
    try {
      const res = await getNetworkWifi(agentId);
      setWifi(res.wifi ?? []);
    } catch { /* ignore */ }
    finally { setWifiLoading(false); }
  }, [agentId]);

  const fetchNearby = useCallback(async () => {
    try {
      const res = await getNetworkNearby(agentId);
      setNearbyWifi(res.nearbyWifi ?? []);
    } catch { /* ignore */ }
    finally { setNearbyLoading(false); }
  }, [agentId]);

  const fetchProxy = useCallback(async () => {
    try {
      const res = await getNetworkProxy(agentId);
      setProxy(res.proxy ?? null);
      setDnsSuffix(res.dnsSuffix ?? '');
    } catch { /* ignore */ }
    finally { setProxyLoading(false); }
  }, [agentId]);

  useEffect(() => {
    fetchWan();
    fetchWifi();
    fetchNearby();
    fetchProxy();
  }, [fetchWan, fetchWifi, fetchNearby, fetchProxy]);

  const lanColumns: DataGridColumn<LanDevice>[] = [
    {
      id: 'ip', header: t('system.ipAddress'), isRowHeader: true,
      cell: (item) => <span className="font-mono text-sm">{item.ip}</span>,
    },
    {
      id: 'mac',
      header: t('system.mac'),
      cell: (item) => <span className="font-mono text-sm text-default-500">{item.mac || '—'}</span>,
    },
    {
      id: 'hostname',
      header: t('system.hostname'),
      cell: (item) => <span className="text-sm text-default-500">{item.hostname || '—'}</span>,
    },
    {
      id: 'source',
      header: t('system.source'),
      cell: (item) => (
        <span className={`text-xs font-medium ${item.source === 'arp' ? 'text-blue-600' : 'text-green-600'}`}>
          {item.source === 'arp' ? t('system.sourceArp') : t('system.sourcePing')}
        </span>
      ),
    },
  ];

  const wifiColumns: DataGridColumn<WifiProfile>[] = [
    {
      id: 'ssid', header: t('system.ssid'), isRowHeader: true,
      cell: (item) => <span className="font-mono text-sm">{item.ssid}</span>,
    },
    {
      id: 'password', header: t('system.password'),
      cell: (item) => (
        <span className="font-mono text-sm text-default-500">
          {item.password || '—'}
        </span>
      ),
    },
  ];

  const nearbyWifiColumns: DataGridColumn<NearbyWifiNetwork>[] = [
    {
      id: 'ssid', header: t('system.ssid'), isRowHeader: true,
      cell: (item) => <span className="font-mono text-sm">{item.ssid}</span>,
    },
    {
      id: 'bssid', header: 'BSSID',
      cell: (item) => <span className="font-mono text-xs text-default-500">{item.bssid || '—'}</span>,
    },
    {
      id: 'auth', header: t('system.auth'),
      cell: (item) => <span className="text-xs text-default-500">{item.auth}</span>,
    },
    {
      id: 'encryption', header: t('system.encryption'),
      cell: (item) => <span className="text-xs text-default-500">{item.encryption || '—'}</span>,
    },
    {
      id: 'signal', header: t('system.signal'),
      cell: (item) => (
        <span className={`text-xs font-medium tabular-nums ${item.signal >= 50 ? 'text-green-600' : item.signal >= 20 ? 'text-amber-600' : 'text-red-500'}`}>
          {item.signal}%
        </span>
      ),
    },
    {
      id: 'band', header: t('system.band'),
      cell: (item) => <span className="text-xs text-default-500">{item.band || '—'}</span>,
    },
  ];

  const LoadingSpinner = () => (
    <div className="flex items-center justify-center gap-2 py-4 text-sm text-default-500">
      <span className="inline-block w-3 h-3 border-2 border-neutral-300 border-t-blue-500 rounded-full animate-spin" />
      {t('common.loading')}
    </div>
  );

  return (
    <div className="space-y-3 overflow-y-auto">
      {/* LAN Scan */}
      <Card className="p-4 rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-700">{t('system.lanScan')}</h3>
          <Button
            size="sm"
            variant="primary"
            isDisabled={scanning}
            onPress={handleScan}
          >
            <Magnifier className="w-4 h-4" />
            <span className="ml-1">{scanning ? t('system.scanning') : t('system.startScan')}</span>
          </Button>
        </div>

        {scanning && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-default-500">
            <span className="inline-block w-4 h-4 border-2 border-neutral-300 border-t-blue-500 rounded-full animate-spin" />
            {t('system.scanning')}
          </div>
        )}

        {scanError && (
          <div className="flex justify-center py-6 text-danger text-sm">
            {scanError}
          </div>
        )}

        {!scanning && !scanError && lanDevices && lanDevices.length === 0 && (
          <div className="flex justify-center py-6 text-default-500 text-sm">
            {t('system.noLanDevices')}
          </div>
        )}

        {!scanning && lanDevices && lanDevices.length > 0 && (
          <>
            <p className="text-xs text-default-500 mb-2">
              {t('system.scanComplete', { count: lanDevices.length, subnets: lanSubnets.length })}
            </p>
            <DataGrid
              aria-label={t('system.lanScan')}
              columns={lanColumns}
              data={lanDevices}
              getRowId={(item) => item.ip}
              scrollContainerClassName="max-h-60"
            />
          </>
        )}
      </Card>

      {/* Proxy */}
      <Card className="p-4 rounded-xl">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">{t('system.proxySettings')}</h3>
        {proxyLoading ? <LoadingSpinner /> : proxy ? (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-default-500">{t('system.proxyEnabled')}</span>
              <span className={proxy.enabled ? 'text-success font-medium' : 'text-default-500'}>
                {proxy.enabled ? t('common.yes') : t('common.no')}
              </span>
            </div>
            {proxy.enabled && (
              <div className="flex justify-between text-sm">
                <span className="text-default-500">{t('system.proxyServer')}</span>
                <span className="font-mono">{proxy.server || '—'}</span>
              </div>
            )}
            {dnsSuffix && (
              <div className="flex justify-between text-sm">
                <span className="text-default-500">DNS Suffix</span>
                <span className="font-mono">{dnsSuffix}</span>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      {/* Nearby WiFi Networks */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">{t('system.nearbyWifi')}</h3>
        <Card className="rounded-xl">
          {nearbyLoading ? (
            <div className="p-4"><LoadingSpinner /></div>
          ) : (
            <DataGrid
              aria-label={t('system.nearbyWifi')}
              columns={nearbyWifiColumns}
              data={nearbyWifi ?? []}
              getRowId={(item) => item.bssid || item.ssid}
              scrollContainerClassName="max-h-52"
              renderEmptyState={() => (
                <div className="flex justify-center py-6 text-default-500 text-sm">
                  {t('system.noNearbyWifi')}
                </div>
              )}
            />
          )}
        </Card>
      </div>

      {/* WiFi Profiles */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">{t('system.wifiProfiles')}</h3>
        <Card className="rounded-xl">
          {wifiLoading ? (
            <div className="p-4"><LoadingSpinner /></div>
          ) : (
            <DataGrid
              aria-label={t('system.wifiProfiles')}
              columns={wifiColumns}
              data={wifi ?? []}
              getRowId={(item) => item.ssid}
              scrollContainerClassName="max-h-52"
              renderEmptyState={() => (
                <div className="flex justify-center py-6 text-default-500 text-sm">
                  {t('system.noWifi')}
                </div>
              )}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
