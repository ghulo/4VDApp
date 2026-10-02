import type { PaginationMeta } from '../services/types';
import { Button } from './ui';

interface PaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  itemLabel: string;
}

export function Pagination({ meta, onPageChange, itemLabel }: PaginationProps) {
  const pageCount = Math.max(Math.ceil(meta.total / meta.limit), 1);
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const last = Math.min(meta.page * meta.limit, meta.total);

  return (
    <nav className="pagination" aria-label="Pages">
      <span className="pagination__summary">
        {first}–{last} of {meta.total} {itemLabel}
      </span>
      {pageCount > 1 && (
        <span className="pagination__buttons">
          <Button size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
            Previous
          </Button>
          <Button size="sm" disabled={meta.page >= pageCount} onClick={() => onPageChange(meta.page + 1)}>
            Next
          </Button>
        </span>
      )}
    </nav>
  );
}
