import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, Button, Card, Dropdown, Spinner } from '@heroui/react';
import { ChevronDown } from '@gravity-ui/icons';
import { getRiskPolicy, saveRiskPolicy, type RiskLevel, type RiskMappings } from '../../api/riskPolicy';

const RISK_LEVELS: RiskLevel[] = ['Safe', 'Normal', 'Dangerous', 'Malicious'];

const LEVEL_COLORS: Record<RiskLevel, string> = {
  Safe: 'text-green-600',
  Normal: 'text-blue-600',
  Dangerous: 'text-orange-600',
  Malicious: 'text-red-600',
};

const MODULES: { titleKey: string; keys: string[] }[] = [
  {
    titleKey: 'riskPolicy.modules.system',
    keys: ['system.info', 'system.processes', 'system.process.kill', 'system.windows', 'system.env', 'system.network', 'system.lanscan'],
  },
  {
    titleKey: 'riskPolicy.modules.surveillance',
    keys: ['screen.monitor', 'media.camera', 'media.mic'],
  },
  {
    titleKey: 'riskPolicy.modules.files',
    keys: ['file.drives', 'file.list', 'file.read', 'file.write', 'file.delete', 'file.mkdir', 'file.rename', 'file.move', 'file.copy', 'file.compress', 'file.decompress', 'file.shortcut'],
  },
  {
    titleKey: 'riskPolicy.modules.software',
    keys: ['othersoft.wechat', 'othersoft.browser', 'othersoft.browser.search', 'othersoft.ai'],
  },
  {
    titleKey: 'riskPolicy.modules.command',
    keys: ['shell.command', 'credentials'],
  },
  {
    titleKey: 'riskPolicy.modules.network',
    keys: ['proxy.fetch'],
  },
  {
    titleKey: 'riskPolicy.modules.admin',
    keys: ['account.manage', 'accesskey.manage', 'builder.build', 'agent.delete', 'agent.kill_all', 'task.create', 'auth.login'],
  },
];

export default function RiskPolicyTab() {
  const { t } = useTranslation();
  const [mappings, setMappings] = useState<RiskMappings | null>(null);
  const [defaults, setDefaults] = useState<RiskMappings>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getRiskPolicy()
      .then((res) => {
        setMappings(res.mappings);
        setDefaults(res.defaults);
      })
      .catch(() => setMappings({}));
  }, []);

  const setLevel = (key: string, level: RiskLevel) => {
    setMappings((m) => ({ ...m, [key]: level }));
  };

  const resetToRecommended = () => {
    setMappings({ ...defaults });
  };

  const save = async () => {
    if (!mappings) return;
    setSaving(true);
    try {
      await saveRiskPolicy(mappings);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  if (!mappings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">{t('riskPolicy.title')}</h2>
          <p className="text-sm text-default-500">{t('riskPolicy.desc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onPress={resetToRecommended}>
            {t('riskPolicy.resetRecommended')}
          </Button>
          <Button variant="primary" isPending={saving} onPress={save}>
            {t('common.save')}
          </Button>
        </div>
      </div>

      <Accordion className="w-full">
        {MODULES.map((mod) => (
          <Accordion.Item key={mod.titleKey}>
            <Accordion.Heading>
              <Accordion.Trigger>
                <span className="font-semibold">{t(mod.titleKey)}</span>
                <Accordion.Indicator>
                  <ChevronDown />
                </Accordion.Indicator>
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body>
                <div className="divide-y divide-default-100">
                  {mod.keys.map((key) => {
                    const level = mappings[key] ?? 'Normal';
                    const recommended = defaults[key] ?? 'Normal';
                    return (
                      <div key={key} className="flex items-center justify-between gap-4 px-3 py-2">
                        <span className="text-sm">{t(`riskPolicy.labels.${key}`)}</span>
                        <Dropdown>
                          <Button variant="outline" className={LEVEL_COLORS[level]}>
                            {t(`riskLevel.${level}`)}
                          </Button>
                          <Dropdown.Popover>
                            <Dropdown.Menu
                              selectedKeys={[level]}
                              selectionMode="single"
                              onAction={(k) => {
                                const v = String(k);
                                if (v === '__recommended__') setLevel(key, recommended);
                                else setLevel(key, v as RiskLevel);
                              }}
                            >
                              <Dropdown.Item key="__recommended__" id="__recommended__" textValue={t('riskPolicy.recommended')}>
                                {t('riskPolicy.recommended')} ({t(`riskLevel.${recommended}`)})
                              </Dropdown.Item>
                              {RISK_LEVELS.map((l) => (
                                <Dropdown.Item key={l} id={l} textValue={t(`riskLevel.${l}`)}>
                                  {t(`riskLevel.${l}`)}
                                </Dropdown.Item>
                              ))}
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </div>
                    );
                  })}
                </div>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Card>
  );
}
