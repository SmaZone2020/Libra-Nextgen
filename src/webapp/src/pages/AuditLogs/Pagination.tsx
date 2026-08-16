import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, total, pageSize, loading, onPageChange }: PaginationProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800">
      <span className="text-sm text-default-500">
        {total > 0
          ? t('audit.showing', { start: (page - 1) * pageSize + 1, end: Math.min(page * pageSize, total), total })
          : t('common.noResults')}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          isDisabled={page <= 1 || loading}
          onPress={() => onPageChange(page - 1)}
        >
          {t('audit.previous')}
        </Button>
        <span className="text-sm text-default-600">
          {t('audit.page', { page, totalPages })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={page >= totalPages || loading}
          onPress={() => onPageChange(page + 1)}
        >
          {t('audit.next')}
        </Button>
      </div>
    </div>
  );
}
