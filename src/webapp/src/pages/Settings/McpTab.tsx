import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Label, Spinner, Switch } from '@heroui/react';
import { getMcpInfo, setMcpEnabled, type McpInfo } from '../../api/mcp';

export default function McpTab() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    getMcpInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await setMcpEnabled(enabled);
      setInfo((i) => (i ? { ...i, enabled } : i));
    } catch {
      /* ignore */
    } finally {
      setToggling(false);
    }
  };

  if (!info) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{t('mcp.title')}</h2>
            <p className="text-sm text-default-500">{t('mcp.desc')}</p>
          </div>
          <Switch isSelected={info.enabled} isDisabled={toggling} onChange={handleToggle}>
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-default-500">{t('mcp.endpoint')}</span>
            <span className="font-mono">{info.endpoint}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-default-500">{t('mcp.transport')}</span>
            <span>{info.transport}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-default-500">{t('mcp.auth')}</span>
            <span>{info.auth}</span>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-3">{t('mcp.tools')} ({info.tools.length})</h2>
        <div className="divide-y divide-default-100">
          {info.tools.map((tool) => (
            <div key={tool.name} className="py-2">
              <div className="font-mono text-sm">{tool.name}</div>
              {tool.description && <div className="text-xs text-default-500">{tool.description}</div>}
            </div>
          ))}
          {info.tools.length === 0 && (
            <div className="py-6 text-center text-default-400 text-sm">{t('mcp.noTools')}</div>
          )}
        </div>
      </Card>
    </div>
  );
}
