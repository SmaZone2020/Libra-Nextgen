export type ToolPartState =
  | 'input-available'
  | 'input-streaming'
  | 'output-available'
  | 'output-error'
  | 'requires-action';
