import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Terminal from '../../components/terminal';
import type { TerminalHandle } from '../../components/terminal';
import { createTask, getTask } from '../../api/tasks';
import { useAgent } from '../../contexts/AgentContext';
import { AgentRequired } from '../../components/AgentRequired';
import { unwrapTaskOutput } from './taskOutput';

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
          // task.output 是嵌套 JSON（agent wrap_result 原样存储模块输出），
          // 先解包出内层文本再上终端。
          const text = unwrapTaskOutput(cur.output ?? cur.error ?? '');
          if (text.trim()) print(text);
          print('\r\n');
        }
      }
      if (!done) print(`\r\n${t('shell.timeout')}\r\n`);
    } catch (e) {
      print(`\r\n${t('shell.error', { msg: e instanceof Error ? e.message : String(e) })}\r\n`);
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
      print(`${t('shell.banner')}\r\n`);
    }
  }, [agentId, print, t]);

  return (
    <div className="space-y-3">
      {!agentId && <AgentRequired />}

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
