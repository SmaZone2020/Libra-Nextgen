import { useTranslation } from 'react-i18next';
import { Input, Button } from '@heroui/react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  loading: boolean;
}

export function SearchBar({ value, onChange, onSearch, loading }: SearchBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-1 max-w-md">
        <Input
          fullWidth
          placeholder={t('audit.searchPlaceholder')}
          value={value}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        />
      </div>
      <Button variant="primary" onPress={onSearch} isDisabled={loading}>
        {t('common.search')}
      </Button>
    </div>
  );
}
