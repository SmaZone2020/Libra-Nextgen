import { useTranslation } from 'react-i18next';
import { Button, Modal } from '@heroui/react';

interface AgreementModalProps {
  onAccept: () => void;
  onDecline: () => void;
}

/// Shown on a user's first login, before they can use the console.
export function AgreementModal({ onAccept, onDecline }: AgreementModalProps) {
  const { t } = useTranslation();

  return (
    <Modal.Backdrop isOpen isDismissable={false} onOpenChange={(open) => { if (!open) onDecline(); }}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{t('agreement.title')}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="text-sm text-default-600 leading-relaxed">{t('agreement.body')}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onDecline}>{t('agreement.decline')}</Button>
            <Button variant="primary" onPress={onAccept}>{t('agreement.accept')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
