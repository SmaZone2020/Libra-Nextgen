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
      <Modal.Container placement="center" size="lg">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{t('agreement.title')}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="space-y-4 text-sm leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
              <div className="p-3 rounded-lg bg-danger-50 text-danger-700 font-semibold border border-danger-200">
                {t('agreement.warning')}
              </div>

              <Section title={t('agreement.authorizedTitle')}>{t('agreement.authorized')}</Section>
              <Section title={t('agreement.prohibitedTitle')}>{t('agreement.prohibited')}</Section>
              <Section title={t('agreement.legalTitle')}>{t('agreement.legal')}</Section>
              <Section title={t('agreement.liabilityTitle')}>{t('agreement.liability')}</Section>

              <p className="text-default-800 font-medium">{t('agreement.confirm')}</p>
            </div>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="font-semibold text-default-800">{title}</h3>
      <p className="text-default-600">{children}</p>
    </div>
  );
}
