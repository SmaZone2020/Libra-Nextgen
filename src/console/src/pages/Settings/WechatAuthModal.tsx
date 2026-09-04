'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Button, Modal, Spinner } from '@heroui/react';
import { CircleCheck } from '@gravity-ui/icons';
import {
  getAiChannelQrStatus,
  getAiChannelWechatQrCode,
  setAiChannelWechatToken,
  type AiChannel,
  type AiChannelQrStatus,
} from '../../api/aiChannels';

export default function WechatAuthModal({
  channel,
  open,
  onClose,
  onTokenSet,
}: {
  channel: AiChannel | null;
  open: boolean;
  onClose: () => void;
  onTokenSet: (token: string) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'scanning' | 'done' | 'error'>('idle');
  const [imageUrl, setImageUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrcode, setQrcode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const buildQrFromUrl = useCallback(async (url: string) => {
    return QRCode.toDataURL(url, { width: 280, margin: 2 });
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setError(null);
    void getAiChannelWechatQrCode()
      .then(async (r) => {
        if (cancelled) return;
        setQrcode(r.qrcode);
        setImageUrl(r.imageUrl);
        try {
          const url = await buildQrFromUrl(r.imageUrl);
          if (cancelled) return;
          setQrDataUrl(url);
          setPhase('scanning');
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
          setPhase('error');
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, buildQrFromUrl]);

  useEffect(() => {
    if (!open || phase !== 'scanning' || qrcode.length === 0) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r: AiChannelQrStatus = await getAiChannelQrStatus(qrcode);
        if (stopped) return;
        if (r.status === 'confirmed' && r.botToken) {
          setPolling(false);
          setPhase('done');
          if (channel) {
            try {
              await setAiChannelWechatToken(channel.id, r.botToken, r.baseUrl, r.ilinkBotId);
            } catch {
            }
          }
          if (!stopped) onTokenSet(r.botToken);
          return;
        }
        if (r.status === 'expired') {
          setPolling(false);
          setError(t('channels.clawQrExpired'));
          setPhase('error');
          return;
        }
        timer = setTimeout(() => void poll(), 2000);
      } catch {
        if (stopped) return;
        timer = setTimeout(() => void poll(), 2000);
      }
    };
    setPolling(true);
    void poll();
    return () => {
      stopped = true;
      setPolling(false);
      if (timer) clearTimeout(timer);
    };
  }, [open, phase, qrcode, channel, t, onTokenSet]);

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Container placement="center" size="sm">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('channels.clawAuthorize')} · {channel?.name ?? ''}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex flex-col items-center gap-3 py-2">
              {phase === 'loading' && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Spinner size="lg" />
                  <p className="text-sm text-default-500">{t('channels.clawQrLoading')}</p>
                </div>
              )}
              {phase === 'scanning' && (
                <>
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrDataUrl}
                      alt={t('channels.clawAuthorize')}
                      className="size-56 rounded-2xl border border-default-200 bg-white object-contain p-2 dark:border-default-800"
                    />
                  ) : (
                    <div className="flex size-56 items-center justify-center rounded-2xl border border-default-200 dark:border-default-800">
                      <Spinner size="lg" />
                    </div>
                  )}
                  <p className="flex items-center gap-2 text-sm text-default-500">
                    {polling && <Spinner size="sm" />}
                    {t('channels.clawQrHint')}
                  </p>
                </>
              )}
              {phase === 'done' && (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <CircleCheck className="size-10 text-success" />
                  <p className="text-sm font-medium">{t('channels.clawQrSuccess')}</p>
                </div>
              )}
              {phase === 'error' && (
                <div className="flex w-full flex-col items-center gap-3 py-4 text-center">
                  <p className="text-sm text-danger">{error}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      setPhase('loading');
                      setError(null);
                      setQrcode('');
                      setQrDataUrl('');
                      void getAiChannelWechatQrCode()
                        .then(async (r) => {
                          setQrcode(r.qrcode);
                          setImageUrl(r.imageUrl);
                          try {
                            setQrDataUrl(await buildQrFromUrl(r.imageUrl));
                            setPhase('scanning');
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                            setPhase('error');
                          }
                        })
                        .catch((e) => {
                          setError(e instanceof Error ? e.message : String(e));
                          setPhase('error');
                        });
                    }}
                  >
                    {t('common.retry')}
                  </Button>
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>
              {phase === 'done' ? t('common.close') : t('common.cancel')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
