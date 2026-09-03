import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Spinner } from '@heroui/react';
import { ArrowRotateRight } from '@gravity-ui/icons';
import {
  installPluginFromRegistry,
  getPluginRegistry,
  clearPluginRegistryCache,
  type PluginRegistryIndex,
} from '../../api/plugins';
import { PluginCard } from './PluginCard';

interface MarketTabProps {
  installedIds: Set<string>;
}

export function MarketTab({ installedIds }: MarketTabProps) {
  const { t } = useTranslation();
  const [registry, setRegistry] = useState<PluginRegistryIndex | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force: boolean) => {
    setFail(null);
    if (force) setRefreshing(true);
    try {
      setRegistry(await getPluginRegistry({ force }));
    } catch (e) {
      setFail(e instanceof Error ? e.message : t('plugins.marketFail'));
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    clearPluginRegistryCache();
    await load(true);
  }, [load]);

  const install = async (file: string) => {
    setInstalling(file);
    try {
      await installPluginFromRegistry(file);
      window.location.reload();
    } catch (e) {
      setFail(e instanceof Error ? e.message : 'Install failed');
      setInstalling(null);
    }
  };

  if (registry === null && !fail) {
    return (
      <Card className="p-12 flex items-center justify-center">
        <Spinner size="lg" />
      </Card>
    );
  }

  if (fail) {
    return (
      <Card className="p-4 border border-danger">
        <p className="text-danger text-sm">{fail}</p>
      </Card>
    );
  }

  if (!registry || registry.plugins.length === 0) {
    return (
      <Card className="p-12 text-center text-default-500">
        {t('plugins.marketEmpty')}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">{t('plugins.market')}</h3>
        <Button
          id="market-refresh-btn"
          variant="secondary"
          isPending={refreshing}
          onPress={refresh}
        >
          <ArrowRotateRight className="w-4 h-4" />
          {refreshing ? t('plugins.marketRefreshing') : t('plugins.marketRefresh')}
        </Button>
      </div>

      {registry === null && !fail && (
        <Card className="p-12 flex items-center justify-center">
          <Spinner size="lg" />
        </Card>
      )}

      {fail && (
        <Card className="p-4 border border-danger">
          <div className="flex items-center justify-between gap-4">
            <p className="text-danger text-sm">{fail}</p>
            <Button variant="ghost" onPress={refresh}>
              <ArrowRotateRight className="w-4 h-4" />
              {t('plugins.marketRefresh')}
            </Button>
          </div>
        </Card>
      )}

      {!fail && registry && registry.plugins.length === 0 && (
        <Card className="p-12 text-center text-default-500">
          {t('plugins.marketEmpty')}
        </Card>
      )}

      {!fail && registry && registry.plugins.length > 0 && (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {registry.plugins.map((p) => {
            const installed = installedIds.has(p.pluginId);
            return (
              <PluginCard
                key={p.pluginId}
                name={p.name || p.pluginId}
                description={p.description}
                version={p.version}
                author={p.author}
                hasRoute={false}
                footer={
                  <>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">
                        <span className='mr-3'>{t('plugins.author')}:</span>
                        {p.author && `${p.author}`}
                      </span>
                      <span className="text-sm text-muted">
                        {t('plugins.packSize')}: {(p.size / 1024).toFixed(0)} KB
                      </span>
                    </div>
                    <Button className="w-full sm:w-auto"
                      isDisabled={installed}
                      isPending={installing === p.file}
                      onPress={() => install(p.file)}>
                      {installed ? t('plugins.installedChip') : t('plugins.install')}
                    </Button>
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
