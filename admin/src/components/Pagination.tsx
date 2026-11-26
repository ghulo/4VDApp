import type { PaginationMeta } from '../services/types';
import { Button } from './ui';
import { useT } from '../i18n/useT';
import { pageWindow } from './pageWindow';

interface PaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  itemLabel: string;
}

/**
 * Under a long list: which rows are shown, and the pages. On a computer the page
 * numbers are keys (first, last and the ones around you), the current one raised;
 * it glides to the next page you pick (selectionPills.ts). Phones keep "3 / 40".
 */
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
          {/* Where you are among the pages: figures only, so it needs no words in either language. */}
          <span className="pagination__page" aria-hidden="true">
            {meta.page} / {pageCount}
          </span>
          <span className="pagination__pages">
            {pageWindow(meta.page, pageCount).map((page, index) =>
              page === 'gap' ? (
                <span key={`gap-${index}`} className="pagination__gap" aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={page}
                  type="button"
                  className="pagination__number"
                  aria-label={t.common.pageNumber(page)}
                  aria-current={page === meta.page ? 'page' : undefined}
                  onClick={() => page !== meta.page && onPageChange(page)}
                >
                  {page}
                </button>
              ),
            )}
          </span>
          <Button size="sm" disabled={meta.page >= pageCount} onClick={() => onPageChange(meta.page + 1)}>
            {t.common.next}
          </Button>
        </span>
      )}
    </nav>
  );
}
