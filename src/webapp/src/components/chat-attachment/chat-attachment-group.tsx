'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useMemo } from 'react';
import { composeSlotClassName } from '../../utils/compose';
import { chatAttachmentGroupVariants } from './chat-attachment.styles';

export interface ChatAttachmentGroupRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export const ChatAttachmentGroupRoot = ({
  children,
  className,
  ...props
}: ChatAttachmentGroupRootProps) => {
  const slots = useMemo(() => chatAttachmentGroupVariants(), []);
  return (
    <div
      className={composeSlotClassName(slots?.base, className)}
      data-slot="chat-attachment-group"
      {...props}
    >
      {children}
    </div>
  );
};
