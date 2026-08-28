import type { ComponentProps } from 'react';
import {
  ChatToolApproval,
  ChatToolApprovalActions,
  ChatToolApprove,
  ChatToolArgs,
  ChatToolContent,
  ChatToolError,
  ChatToolMeta,
  ChatToolReject,
  ChatToolResult,
  ChatToolRoot,
  ChatToolStatusIcon,
  ChatToolTrigger,
} from './chat-tool';
export { mapToolStateToVisual } from './chat-tool';
import {
  ChatToolGroupContent,
  ChatToolGroupRoot,
  ChatToolGroupTrigger,
} from './chat-tool-group';
export type {
  ChatToolGroupVariants,
  ChatToolVariants,
} from './chat-tool.styles';
export { chatToolGroupVariants, chatToolVariants } from './chat-tool.styles';
export type { ToolPartState } from './chat-tool.types';

const ChatTool = Object.assign(ChatToolRoot, {
  Approval: ChatToolApproval,
  ApprovalActions: ChatToolApprovalActions,
  Approve: ChatToolApprove,
  Args: ChatToolArgs,
  Content: ChatToolContent,
  Error: ChatToolError,
  Meta: ChatToolMeta,
  Reject: ChatToolReject,
  Result: ChatToolResult,
  Root: ChatToolRoot,
  StatusIcon: ChatToolStatusIcon,
  Trigger: ChatToolTrigger,
});

const ChatToolGroup = Object.assign(ChatToolGroupRoot, {
  Content: ChatToolGroupContent,
  Root: ChatToolGroupRoot,
  Trigger: ChatToolGroupTrigger,
});

export {
  ChatTool,
  ChatToolApproval,
  ChatToolApprovalActions,
  ChatToolApprove,
  ChatToolArgs,
  ChatToolContent,
  ChatToolError,
  ChatToolGroup,
  ChatToolGroupContent,
  ChatToolGroupRoot,
  ChatToolGroupTrigger,
  ChatToolMeta,
  ChatToolReject,
  ChatToolResult,
  ChatToolRoot,
  ChatToolStatusIcon,
  ChatToolTrigger,
};

export type {
  ChatToolActionPresetProps,
  ChatToolApprovalActionsProps,
  ChatToolApprovalProps,
  ChatToolArgsProps,
  ChatToolContentProps,
  ChatToolErrorProps,
  ChatToolMetaProps,
  ChatToolRootProps as ChatToolProps,
  ChatToolResultProps,
  ChatToolRootProps,
  ChatToolStatusIconProps,
  ChatToolTriggerProps,
} from './chat-tool';
export type {
  ChatToolGroupContentProps,
  ChatToolGroupRootProps as ChatToolGroupProps,
  ChatToolGroupRootProps,
  ChatToolGroupTriggerProps,
} from './chat-tool-group';

export type ChatTool = {
  ApprovalActionsProps: ComponentProps<typeof ChatToolApprovalActions>;
  ApprovalProps: ComponentProps<typeof ChatToolApproval>;
  ApproveProps: ComponentProps<typeof ChatToolApprove>;
  ArgsProps: ComponentProps<typeof ChatToolArgs>;
  ContentProps: ComponentProps<typeof ChatToolContent>;
  ErrorProps: ComponentProps<typeof ChatToolError>;
  MetaProps: ComponentProps<typeof ChatToolMeta>;
  Props: ComponentProps<typeof ChatToolRoot>;
  RejectProps: ComponentProps<typeof ChatToolReject>;
  ResultProps: ComponentProps<typeof ChatToolResult>;
  RootProps: ComponentProps<typeof ChatToolRoot>;
  StatusIconProps: ComponentProps<typeof ChatToolStatusIcon>;
  TriggerProps: ComponentProps<typeof ChatToolTrigger>;
};

export type ChatToolGroup = {
  ContentProps: ComponentProps<typeof ChatToolGroupContent>;
  Props: ComponentProps<typeof ChatToolGroupRoot>;
  RootProps: ComponentProps<typeof ChatToolGroupRoot>;
  TriggerProps: ComponentProps<typeof ChatToolGroupTrigger>;
};
