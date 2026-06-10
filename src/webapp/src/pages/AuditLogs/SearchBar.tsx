import { Input, Button } from '@heroui/react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  loading: boolean;
}

export function SearchBar({ value, onChange, onSearch, loading }: SearchBarProps) {
  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-1 max-w-md">
        <Input
          fullWidth
          placeholder="Search by user, action, IP, agent ID..."
          value={value}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        />
      </div>
      <Button variant="primary" onPress={onSearch} isDisabled={loading}>
        Search
      </Button>
    </div>
  );
}
