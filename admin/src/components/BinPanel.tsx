import { ArrowCounterClockwise, File, Package, Receipt, Storefront, User } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { binApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { BinItem, BinKind } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Button, Card, EmptyState, useToast } from './ui';

const ICON: Record<BinKind, typeof File> = { product: Package, supplier: Storefront, customer: User, expense: Receipt, file: File };

/** Settings → Recycle bin: what was removed in the last 90 days, and Put back. */
export function BinPanel() {
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const bin = useQuery({ queryKey: ['bin'], queryFn: binApi.list });
  const restore = useMutation({
    mutationFn: (item: BinItem) => binApi.restore(item.kind, item.id),
    onSuccess: (_result, item) => {
      // What came back shows again on its own page.
      void queryClient.invalidateQueries();
      toast({ title: t.bin.restored(item.kind === 'expense' ? t.bin.kinds.expense : item.name) });
    },
  });

  if (bin.isPending) return <Loading />;
  if (bin.isError) return <ErrorNotice error={bin.error} onRetry={() => bin.refetch()} />;

  return (
    <Card title={t.bin.title} description={t.bin.description} flush={bin.data.length > 0}>
      {bin.data.length === 0 ? (
        <EmptyState icon={ArrowCounterClockwise} title={t.bin.empty}>
          {t.bin.emptyHint}
        </EmptyState>
      ) : (
        <ul className="bin-list">
          {bin.data.map((item) => {
            const Icon = ICON[item.kind];
            const pending = restore.isPending && restore.variables?.kind === item.kind && restore.variables.id === item.id;
            return (
              <li key={`${item.kind}-${item.id}`} className="bin-list__row">
                <Icon size={20} aria-hidden="true" className="bin-list__icon" />
                <span className="bin-list__text">
                  <strong>
                    {item.kind === 'file' && item.file ? (
                      <a href={mediaSrc(item.file.url)!} target="_blank" rel="noreferrer">
                        {item.name}
                        <span className="visually-hidden"> {t.firm.newTab}</span>
                      </a>
                    ) : item.kind === 'expense' ? (
                      t.expenses.categories[item.name as keyof typeof t.expenses.categories] ?? item.name
                    ) : (
                      item.name
                    )}
                  </strong>
                  <span className="table__secondary">
                    {[t.bin.kinds[item.kind], detailOf(item), t.bin.removedOn(formatDate(item.removedAt)), t.bin.leavesOn(formatDate(item.leavesOn))]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Button size="sm" icon={ArrowCounterClockwise} loading={pending} disabled={restore.isPending} onClick={() => restore.mutate(item)} aria-label={t.bin.restoreThis(item.name)}>
                  {t.bin.restore}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {restore.isError && (
        <p className="form-error bin-error" role="alert">
          {errorMessage(restore.error)}
        </p>
      )}
    </Card>
  );
}

function detailOf(item: BinItem): string | null {
  if (item.kind === 'expense' && item.detail) return formatMoney(Number(item.detail));
  return item.detail;
}
