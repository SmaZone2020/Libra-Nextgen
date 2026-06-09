import {
  SheetBackdrop,
  SheetBody,
  SheetClose,
  SheetCloseTrigger,
  SheetContent,
  SheetDialog,
  SheetFooter,
  SheetHandle,
  SheetHeader,
  SheetHeading,
  SheetNestedRoot,
  SheetRoot,
  SheetTrigger,
} from './sheet';
export { sheetVariants } from './sheet.styles';

const Sheet = Object.assign(SheetRoot, {
  Backdrop: SheetBackdrop,
  Body: SheetBody,
  Close: SheetClose,
  CloseTrigger: SheetCloseTrigger,
  Content: SheetContent,
  Dialog: SheetDialog,
  Footer: SheetFooter,
  Handle: SheetHandle,
  NestedRoot: SheetNestedRoot,
  Header: SheetHeader,
  Root: SheetRoot,
  Heading: SheetHeading,
  Trigger: SheetTrigger,
});

export {
  Sheet,
  SheetBackdrop,
  SheetBody,
  SheetClose,
  SheetCloseTrigger,
  SheetContent,
  SheetDialog,
  SheetFooter,
  SheetHandle,
  SheetHeader,
  SheetHeading,
  SheetNestedRoot,
  SheetRoot,
  SheetTrigger,
};

export type {
  SheetBackdropProps,
  SheetBodyProps,
  SheetCloseProps,
  SheetCloseTriggerProps,
  SheetContentProps,
  SheetDialogProps,
  SheetFooterProps,
  SheetHandleProps,
  SheetHeaderProps,
  SheetHeadingProps,
  SheetRootProps as SheetProps,
  SheetRootProps,
  SheetTriggerProps,
} from './sheet';
export type { SheetVariants } from './sheet.styles';
export { sheetVariants as default } from './sheet.styles';
