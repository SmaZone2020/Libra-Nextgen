import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import { createTask, getTask } from '../../api/tasks';
import { useAgent } from '../../contexts/AgentContext';

/**
 * 命令式 Shell（零 WS 架构）：输入命令 → 创建 Shell 任务（SSE 推送执行）→
 * 轮询任务状态 → 结果输出到终端。无交互式 PTY。
 */
export default function ShellPage() {
  const { t } = useTranslation();
  const { agentId } = useAgent();
  const termRef = useRef<TerminalHandle>(null);
  const [running, setRunning] = useState(false);
  const inputBufRef = useRef('');

  const print = useCallback((text: string) => {
    termRef.current?.write(text.replace(/\n/g, '\r\n'));
  }, []);

  const execute = useCallback(async (cmd: string) => {
    if (!agentId || !cmd.trim() || running) return;
    setRunning(true);
    print(`\r\n$ ${cmd}\r\n`);
    try {
      const task = await createTask({
        agentId,
        commandType: 'Shell',
        command: cmd,
        arguments: [],
        timeoutSeconds: 60,
      });
      // 轮询结果（SSE 推送执行，结果经 HTTP 上报后任务进入终态）
      let done = false;
      for (let i = 0; i < 240 && !done; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const cur = await getTask(task.id);
        if (cur.status === 'Completed' || cur.status === 'Failed' || cur.status === 'Cancelled') {
          done = true;
          const out = cur.output ?? cur.error ?? '';
          if (out.trim()) print(out);
          print('\r\n');
        }
      }
      if (!done) print('\r\n[timeout] task did not finish in time\r\n');
    } catch (e) {
      print(`\r\n[error] ${e instanceof Error ? e.message : String(e)}\r\n`);
    } finally {
      setRunning(false);
      termRef.current?.focus();
    }
  }, [agentId, running, print]);

  const handleInput = useCallback((data: string) => {
    if (data === '\r' || data === '\n' || data === '\r\n') {
      const cmd = inputBufRef.current;
      inputBufRef.current = '';
      print('\r\n');
      if (cmd.trim()) execute(cmd);
      return;
    }
    if (data === '\x7f' || data === '\b') {
      // backspace
      if (inputBufRef.current.length > 0) {
        inputBufRef.current = inputBufRef.current.slice(0, -1);
        termRef.current?.write('\b \b');
      }
      return;
    }
    if (data === '\x03') {
      // Ctrl+C: 清空当前输入
      inputBufRef.current = '';
      print('^C');
      return;
    }
    // 忽略控制字符
    if (data.length !== 1 || data.charCodeAt(0) < 0x20) return;
    inputBufRef.current += data;
    termRef.current?.write(data);
  }, [execute, print]);

  useEffect(() => {
    if (agentId) {
      termRef.current?.clear();
      print(`Libra-Nextgen 命令式 Shell（任务模式）\r\n输入命令后回车执行，Ctrl+C 清空输入。\r\n\r\n`);
    }
  }, [agentId, print]);

  return (
    <div className="space-y-3">
      {!agentId && (
        <div
          className="flex items-center justify-center text-neutral-500 text-sm select-none"
          style={{ height: 'calc(100vh - 240px)', minHeight: 400 }}
        >
          {t('shell.selectAgent')}
        </div>
      )}

      {agentId && (
        <Terminal
          key={agentId}
          ref={termRef}
          disabled={!agentId}
          onInput={handleInput}
          style={{ height: '100%', width: '100%' }}
        />
      )}
    </div>
  );
}
