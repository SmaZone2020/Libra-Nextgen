'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Label, ListBox, Modal, Select, Spinner } from '@heroui/react';
import { Copy } from '@gravity-ui/icons';
import {
  createAiBindCode,
  getAiChannelBindCodes,
  revokeAiBindCode,
  type AiBindCode,
  type AiBindCodeInfo,
  type AiChannel,
} from '../../api/aiChannels';
import { listAccounts } from '../../api/account';
import { useDialog } from '../../hooks/useDialog';

export default function BindCodeModal({ channel, onClose }: { channel: AiChannel; onClose: () => void }) {
  const { t } = useTranslation();
  const { confirm, alert, DialogComponent } = useDialog();
  const [accounts, setAccounts] = useState<{ id: string; username: string }[]>([]);
  const [userId, setUserId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<AiBindCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<AiBindCodeInfo[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadCodes = useCallback(async () => {
    try {
      setCodes(await getAiChannelBindCodes(channel.id));
    } catch {
      /* ignore */
    }
  }, [channel.id]);

  useEffect(() => {
    void listAccounts()
      .then((list) => {
        setAccounts(list.map((a) => ({ id: a.id, username: a.username })));
        const first = list[0];
        if (first) setUserId(first.id);
      })
      .catch(() => undefined);
    void loadCodes();
  }, [loadCodes]);

  const handleGenerate = async () => {
    if (!userId) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      setResult(await createAiBindCode(channel.id, userId));
      await loadCodes();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (code: AiBindCodeInfo) => {
    const { confirmed } = await confirm(t('channels.revokeCodeConfirm', { tail: code.codeTail }));
    if (!confirmed) return;
    setRevoking(code.id);
    try {
      await revokeAiBindCode(channel.id, code.id);
      await loadCodes();
    } catch (e) {
      await alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRevoking(null);
    }
  };

  const handleCopy = () => {
    if (result) void navigator.clipboard?.writeText(result.code).catch(() => undefined);
  };

  const now = Date.now();
  const statusOf = (c: AiBindCodeInfo): { label: string; color: string; revocable: boolean } => {
    if (c.revokedAt) return { label: t('channels.codeRevoked'), color: 'text-default-400', revocable: false };
    if (c.usedAt) return { label: t('channels.codeUsed'), color: 'text-success', revocable: false };
    if (new Date(c.expiresAt).getTime() <= now) return { label: t('channels.codeExpired'), color: 'text-default-400', revocable: false };
    return { label: t('channels.codePending'), color: 'text-warning', revocable: true };
  };

  return (
    <>
    <Modal.Backdrop isOpen onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="sm">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('channels.bindCode')} · {channel.name}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-3">
              {/* 账号选择 + 生成按钮同行：按钮与 Select 底边对齐（不与 Label 对齐） */}
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Label className="mb-1.5 block text-sm">{t('channels.bindForUser')}</Label>
                  <Select
                    selectedKey={userId}
                    onSelectionChange={(key) => { if (key) setUserId(String(key)); }}
                    variant="secondary"
                  >
                    <Select.Trigger className="w-full">
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox items={accounts}>
                        {(item) => (
                          <ListBox.Item key={item.id} id={item.id} textValue={item.username}>
                            {item.username}
                          </ListBox.Item>
                        )}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
                <Button size="sm" variant="primary" isDisabled={!userId} className="shrink-0"
                  onPress={() => void handleGenerate()}>
                  {generating ? <Spinner size="sm" /> : null}
                  {t('channels.generate')}
                </Button>
              </div>
              {error && <p className="text-xs text-danger">{error}</p>}
              {result && (
                <div className="rounded-2xl border border-default-200 p-4 dark:border-default-800">
                  <p className="text-xs text-default-500">{t('channels.bindCodeHint')}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 select-all rounded-xl bg-default/10 px-3 py-2 font-mono text-lg tracking-widest">
                      {result.code}
                    </code>
                    <Button isIconOnly size="sm" variant="tertiary" onPress={handleCopy}>
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  {result.bindUrl && (
                    <a
                      href={result.bindUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate text-xs text-primary underline"
                    >
                      {result.bindUrl}
                    </a>
                  )}
                  <p className="mt-2 text-xs text-default-500">
                    {t('channels.expires')} {new Date(result.expiresAt).toLocaleString()}
                  </p>
                </div>
              )}

              {/* 绑定码列表（可作废未使用码） */}
              <div>
                <Label className="mb-1.5 block text-sm">{t('channels.codeList')}</Label>
                {codes.length === 0 ? (
                  <div className="py-4 text-center text-xs text-default-400">{t('channels.noCodes')}</div>
                ) : (
                  <div className="max-h-56 space-y-1.5 overflow-y-auto">
                    {codes.map((c) => {
                      const st = statusOf(c);
                      return (
                        <div
                          key={c.id}
                          className="flex items-center gap-2 rounded-xl border border-default-200 px-3 py-2 dark:border-default-800"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-mono text-xs">
                              ····{c.codeTail}
                              <span className={`ml-2 ${st.color}`}>{st.label}</span>
                            </span>
                            <div className="truncate text-[11px] text-default-500">
                              {c.boundUserName} · {new Date(c.createdAt).toLocaleString()}
                            </div>
                          </div>
                          {st.revocable && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-danger"
                              isDisabled={revoking === c.id}
                              onPress={() => void handleRevoke(c)}
                            >
                              {revoking === c.id ? <Spinner size="sm" /> : t('channels.revoke')}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>{t('common.close')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
    {DialogComponent}
    </>
  );
}
