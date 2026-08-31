import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label, Modal, TextField } from '@heroui/react';

type DialogType = 'alert' | 'confirm' | 'prompt';

interface DialogState {
  type: DialogType;
  title: string;
  message: string;
  defaultValue?: string;
}

interface DialogResult {
  confirmed: boolean;
  value?: string;
}

export function useDialog() {
  const { t } = useTranslation();
  const [state, setState] = useState<DialogState | null>(null);
  const resolveRef = useRef<((result: DialogResult) => void) | null>(null);
  const [inputValue, setInputValue] = useState('');

  const showDialog = useCallback(
    (type: DialogType, message: string, defaultValue?: string, title?: string): Promise<DialogResult> => {
      const fallback = type === 'alert'
        ? t('dialog.notice')
        : type === 'confirm'
          ? t('dialog.confirm')
          : t('dialog.input');
      setInputValue(defaultValue ?? '');
      setState({ type, title: title ?? fallback, message, defaultValue });
      return new Promise<DialogResult>((resolve) => {
        resolveRef.current = resolve;
      });
    },
    [t],
  );

  const handleClose = useCallback((confirmed: boolean) => {
    const value = state?.type === 'prompt' ? inputValue : undefined;
    resolveRef.current?.({ confirmed, value });
    resolveRef.current = null;
    setState(null);
  }, [state, inputValue]);

  const alert = useCallback((message: string, title?: string) => showDialog('alert', message, undefined, title), [showDialog]);
  const confirm = useCallback((message: string, title?: string) => showDialog('confirm', message, undefined, title), [showDialog]);
  const prompt = useCallback(
    (message: string, defaultValue?: string, title?: string) => showDialog('prompt', message, defaultValue, title),
    [showDialog],
  );

  const DialogComponent = state ? (
    <Modal.Backdrop isOpen isDismissable={state.type !== 'prompt'} onOpenChange={(open) => { if (!open) handleClose(false); }}>
      <Modal.Container placement="center" size="sm">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{state.title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="text-sm text-default-700">{state.message}</p>
            {state.type === 'prompt' && (
              <TextField variant="secondary" className="mt-3" autoFocus>
                <Label className="sr-only">Input</Label>
                <Input variant="secondary"
                  value={inputValue}
                  onChange={(e) => setInputValue((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleClose(true); }}
                />
              </TextField>
            )}
          </Modal.Body>
          <Modal.Footer>
            {state.type !== 'alert' && (
              <Button variant="ghost" size="sm" onPress={() => handleClose(false)}>
                {t('common.cancel')}
              </Button>
            )}
            <Button variant="primary" size="sm" onPress={() => handleClose(true)}>
              {state.type === 'alert' ? t('common.close') : t('common.confirm')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  ) : null;

  return { alert, confirm, prompt, DialogComponent };
}
