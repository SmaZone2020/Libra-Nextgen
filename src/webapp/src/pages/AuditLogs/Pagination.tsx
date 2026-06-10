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
  return (
    <div className="flex items-center justify-between mt-4 pt-4 border-t border-neutral-200">
      <span className="text-sm text-default-500">
        {total > 0
          ? `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}`
          : 'No results'}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          isDisabled={page <= 1 || loading}
          onPress={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-default-600">
          Page {page} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={page >= totalPages || loading}
          onPress={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
