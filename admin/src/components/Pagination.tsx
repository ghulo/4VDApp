import type { PaginationMeta } from '../services/types';
import { Button } from './ui';
import { useT } from '../i18n/useT';

interface PaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  itemLabel: string;
}

export function Pagination({ meta, onPageChange, itemLabel }: PaginationProps) {
  const t = useT();
  const pageCount = Math.max(Math.ceil(meta.total / meta.limit), 1);
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const last = Math.min(meta.page * meta.limit, meta.total);

  return (
    <nav className="pagination" aria-label={t.common.pages}>
      <span className="pagination__summary">
        {t.common.pageRange({ first, last, total: meta.total, items: itemLabel })}
      </span>
      {pageCount > 1 && (
        <span className="pagination__buttons">
          <Button size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
            {t.common.previous}
          </Button>
          <Button size="sm" disabled={meta.page >= pageCount} onClick={() => onPageChange(meta.page + 1)}>
            {t.common.next}
          </Button>
        </span>
      )}
    </nav>
  );
}
