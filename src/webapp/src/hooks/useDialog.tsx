import { useState, useCallback, useRef } from 'react';
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
  const [state, setState] = useState<DialogState | null>(null);
  const resolveRef = useRef<((result: DialogResult) => void) | null>(null);
  const [inputValue, setInputValue] = useState('');

  const showDialog = useCallback((type: DialogType, message: string, defaultValue?: string): Promise<DialogResult> => {
    const title = type === 'alert' ? 'Notice' : type === 'confirm' ? 'Confirm' : 'Input';
    setInputValue(defaultValue ?? '');
    setState({ type, title, message, defaultValue });
    return new Promise<DialogResult>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleClose = useCallback((confirmed: boolean) => {
    const value = state?.type === 'prompt' ? inputValue : undefined;
    resolveRef.current?.({ confirmed, value });
    resolveRef.current = null;
    setState(null);
  }, [state, inputValue]);

  const alert = useCallback((message: string) => showDialog('alert', message), [showDialog]);
  const confirm = useCallback((message: string) => showDialog('confirm', message), [showDialog]);
  const prompt = useCallback((message: string, defaultValue?: string) => showDialog('prompt', message, defaultValue), [showDialog]);

  const DialogComponent = state ? (
    <Modal.Backdrop isOpen isDismissable={false} onOpenChange={(open) => { if (!open) handleClose(false); }}>
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
                Cancel
              </Button>
            )}
            <Button variant="primary" size="sm" onPress={() => handleClose(true)}>
              OK
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  ) : null;

  return { alert, confirm, prompt, DialogComponent };
}
