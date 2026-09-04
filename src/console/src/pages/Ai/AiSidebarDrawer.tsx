'use client';

import { useTranslation } from 'react-i18next';
import { Drawer, useOverlayState } from '@heroui/react';
import { AiSidebar, type AiSidebarProps } from './AiSidebar';

export function AiSidebarDrawer({
  open,
  onOpenChange,
  ...sidebarProps
}: AiSidebarProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const state = useOverlayState({ isOpen: open, onOpenChange });

  return (
    <Drawer state={state}>
      <Drawer.Backdrop isDismissable>
        <Drawer.Content placement="left">
          <Drawer.Dialog className="px-4 w-60">
            <Drawer.Header>
              <Drawer.Heading>{t('ai.title')}</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body className="p-0">
              <AiSidebar {...sidebarProps} />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
