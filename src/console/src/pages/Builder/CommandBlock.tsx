import { Button } from '@heroui/react';
import { Copy } from '@gravity-ui/icons';

interface CommandBlockProps {
  label: string;
  text: string;
  onCopy: (text: string) => void;
  copied: boolean;
}

export function CommandBlock({ label, text, onCopy, copied }: CommandBlockProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-default-500">{label}</span>
        <Button size="sm" variant="ghost" onPress={() => onCopy(text)} className="h-7 min-w-0 px-2">
          <Copy className="w-3 h-3" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="bg-default-100 rounded p-2 font-mono text-xs whitespace-pre-wrap break-all leading-5 select-all">
        {text}
      </pre>
    </div>
  );
}
