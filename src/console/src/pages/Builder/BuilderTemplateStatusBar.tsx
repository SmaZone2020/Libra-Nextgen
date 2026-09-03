import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Spinner, Tooltip } from '@heroui/react';
import { ArrowRotateRight } from '@gravity-ui/icons';
import { getBuilderStatus, refreshTemplates } from '../../api/build';
import type { BuilderStatus } from '../../api/build';

interface BuilderTemplateStatusBarProps {
  /** Currently selected builder platform key (x64 / win-arm64 / linux-* / mac-arm64). */
  platform: string;
}

/**
 * Builder mode (template vs source) + per-platform prebuilt-template state.
 * In template mode (default) the server does not compile anything — payloads
 * are packaged from template zips fetched from the GitHub release.
 */
export function BuilderTemplateStatusBar({ platform }: BuilderTemplateStatusBarProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BuilderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await getBuilderStatus());
    } catch {
      // Status is advisory; failures are surfaced by the build itself.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!status) return null;

  const templateMode = status.mode === 'template';
  const active = status.platforms.find((p) => p.platform === platform);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshTemplates(platform);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card className="p-2.5 mb-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Chip size="sm" variant="soft" color={templateMode ? 'accent' : 'default'}>
          {templateMode ? t('builder.templateMode') : t('builder.sourceMode')}
        </Chip>
        {active && (
          <Chip size="sm" variant="soft" color={active.template ? 'success' : 'warning'}>
            {active.template ? t('builder.templateCached') : t('builder.templateNotCached')}
          </Chip>
        )}
        {templateMode && active?.template && (
          <span className="text-xs text-default-500 font-mono">
            {t('builder.templateVersion', { tag: active.template.tag, commit: active.template.commit.slice(0, 8) })}
          </span>
        )}
        {templateMode && (
          <Tooltip delay={0}>
            <Button
              size="sm"
              variant="secondary"
              isIconOnly
              isDisabled={refreshing}
              onPress={handleRefresh}
              aria-label={t('builder.refreshTemplate')}
            >
              {refreshing ? <Spinner size="sm" /> : <ArrowRotateRight />}
            </Button>
            <Tooltip.Content placement="top">{t('builder.refreshTemplate')}</Tooltip.Content>
          </Tooltip>
        )}
        {error && <span className="text-xs text-danger flex-1 break-all">{error}</span>}
      </div>
    </Card>
  );
}
