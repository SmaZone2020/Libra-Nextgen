import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown } from '@heroui/react';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import { useShellSession } from './useShellSession';
import { useAgent } from '../../contexts/AgentContext';

type LockMode = 'write' | 'readonly' | null;

type TermFont = 'jetbrains' | 'cjk';

const FONT_OPTIONS: Record<TermFont, string> = {
  // JetBrains Mono: modern Latin; Chinese may drift (~11%) in mixed text.
  jetbrains: '"JetBrainsMono", "LibraTermCJK", ui-monospace, monospace',
  // Monospace CJK (NSimSun etc.): Latin + Chinese align perfectly (2:1).
  cjk: '"LibraTermCJK", "NSimSun", "Noto Sans Mono CJK SC", "Sarasa Mono SC", monospace',
};

const FONT_KEY = 'shell_term_font';

export default function ShellPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const [lockMode, setLockMode] = useState<LockMode>(null);
  const [connected, setConnected] = useState(false);
  const [termFont, setTermFont] = useState<TermFont>(
    () => (localStorage.getItem(FONT_KEY) as TermFont) || 'jetbrains',
  );

  const termRef = useRef<TerminalHandle>(null);

  const handleStateChange = useCallback(({ connected: c, lockMode: m }: { connected: boolean; lockMode: LockMode }) => {
    setConnected(c);
    setLockMode(m);
  }, []);

  const { bind, disconnect, sendInput, sendResize } = useShellSession({ termRef, onStateChange: handleStateChange });

  useEffect(() => {
    if (agentId) {
      bind(agentId);
    } else {
      disconnect();
    }
  }, [agentId, bind, disconnect]);

  const handleFontChange = (key: string) => {
    const f = (key as TermFont) in FONT_OPTIONS ? (key as TermFont) : 'jetbrains';
    setTermFont(f);
    localStorage.setItem(FONT_KEY, f);
  };

  return (
    <div className="space-y-3">
      {!agentId && (
        <div
          className="flex items-center justify-center border border-neutral-700 rounded-lg text-neutral-500 text-sm select-none"
          style={{ height: 'calc(100vh - 240px)', minHeight: 400, background: '#1a1b1e' }}
        >
          {t('shell.selectAgent')}
        </div>
      )}

      {agentId && (
        <>
          <div className="flex items-center justify-end">
            <Dropdown>
              <Dropdown.Trigger>
                <button
                  type="button"
                  className="text-xs text-default-500 hover:text-default-700 border border-default-200 rounded-lg px-2 py-1"
                >
                  {termFont === 'jetbrains' ? t('shell.font.jetbrains') : t('shell.font.cjk')}
                </button>
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu onAction={(k) => handleFontChange(String(k))}>
                  <Dropdown.Item id="jetbrains" textValue={t('shell.font.jetbrains')}>
                    {t('shell.font.jetbrains')}
                  </Dropdown.Item>
                  <Dropdown.Item id="cjk" textValue={t('shell.font.cjk')}>
                    {t('shell.font.cjk')}
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>

          <Terminal
            ref={termRef}
            disabled={!connected}
            onInput={sendInput}
            onResize={sendResize}
            fontFamily={FONT_OPTIONS[termFont]}
            className="rounded-lg border border-neutral-700 overflow-hidden"
            style={{ height: 'calc(100vh - 260px)', minHeight: 400 }}
          />
        </>
      )}
    </div>
  );
}
