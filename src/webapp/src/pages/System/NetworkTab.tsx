import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@heroui/react';
import { getNetwork } from '../../api/system';
import { DataGrid } from '../../components/data-grid';
import type { DataGridColumn } from '../../components/data-grid';
import type { NetworkResult, NetworkInterface, WifiProfile } from '../../types/models';

interface NetworkTabProps {
  agentId: string;
}

export function NetworkTab({ agentId }: NetworkTabProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<NetworkResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchNetwork = useCallback(async () => {
    try {
      const res = await getNetwork(agentId);
      setData(res);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => {
    fetchNetwork();
  }, [fetchNetwork]);

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-default-500 text-sm">
        {t('system.loadingNetwork')}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const ifaceColumns: DataGridColumn<NetworkInterface>[] = [
    {
      id: 'name', header: t('system.interfaceName'), isRowHeader: true,
      cell: (item) => <span className="font-mono text-sm">{item.name}</span>,
    },
    {
      id: 'type', header: t('system.interfaceType'),
      cell: (item) => <span className="text-default-500 text-sm">{item.type}</span>,
    },
    {
      id: 'mac', header: t('system.mac'),
      cell: (item) => <span className="font-mono text-sm text-default-500">{item.mac}</span>,
    },
    {
      id: 'ipv4', header: t('system.ipv4'),
      cell: (item) => (
        <span className="font-mono text-sm text-default-500">
          {item.ipv4?.join(', ') || '—'}
        </span>
      ),
    },
    {
      id: 'ipv6', header: t('system.ipv6'),
      cell: (item) => (
        <span className="font-mono text-xs text-default-400">
          {item.ipv6?.join(', ') || '—'}
        </span>
      ),
    },
    {
      id: 'speed', header: t('system.speed'),
      cell: (item) => <span className="text-default-500 text-sm tabular-nums">{item.speed > 0 ? item.speed.toLocaleString() : '—'}</span>,
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

  return (
    <div className="space-y-3 max-h-[calc(100vh-330px)] overflow-y-auto">
      {/* WAN */}
      <Card className="p-4 rounded-xl">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">{t('system.wan')}</h3>
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-default-500">{t('system.publicIp')}</span>
            <span className="font-mono">{data.wan?.publicIp ?? '—'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-default-500">{t('system.gateway')}</span>
            <span className="font-mono">{data.wan?.gateway ?? '—'}</span>
          </div>
        </div>
      </Card>

      {/* Proxy */}
      <Card className="p-4 rounded-xl">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">{t('system.proxySettings')}</h3>
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-default-500">{t('system.proxyEnabled')}</span>
            <span className={data.proxy?.enabled ? 'text-success font-medium' : 'text-default-500'}>
              {data.proxy?.enabled ? t('common.yes') : t('common.no')}
            </span>
          </div>
          {data.proxy?.enabled && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-default-500">{t('system.proxyServer')}</span>
                <span className="font-mono">{data.proxy.server || '—'}</span>
              </div>
              {data.proxy.port > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-default-500">{t('system.proxyPort')}</span>
                  <span className="font-mono tabular-nums">{data.proxy.port}</span>
                </div>
              )}
              {data.proxy.bypass && (
                <div className="flex justify-between text-sm">
                  <span className="text-default-500">{t('system.proxyBypass')}</span>
                  <span className="text-default-700 text-xs max-w-[60%] text-right">{data.proxy.bypass}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {/* LAN Interfaces */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">{t('system.lanInterfaces')}</h3>
        <Card className="rounded-xl">
          <DataGrid
            aria-label={t('system.lanInterfaces')}
            columns={ifaceColumns}
            data={data.interfaces ?? []}
            getRowId={(item) => item.name}
            scrollContainerClassName="max-h-80"
          />
        </Card>
      </div>

      {/* WiFi Profiles */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-700 mb-2">{t('system.wifiProfiles')}</h3>
        <Card className="rounded-xl">
          <DataGrid
            aria-label={t('system.wifiProfiles')}
            columns={wifiColumns}
            data={data.wifi ?? []}
            getRowId={(item) => item.ssid}
            scrollContainerClassName="max-h-52"
            renderEmptyState={() => (
              <div className="flex justify-center py-6 text-default-500 text-sm">
                {t('system.noWifi')}
              </div>
            )}
          />
        </Card>
      </div>
    </div>
  );
}
