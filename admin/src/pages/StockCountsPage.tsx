import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { StatusPill } from '../components/Decision';
import { ErrorNotice, Loading } from '../components/Feedback';
import { categoriesApi, stockCountsApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';
import { Button, DataTable, EmptyState, PageHeader } from '../components/ui';
import { ClipboardText } from '@phosphor-icons/react';
import { useT } from '../i18n/useT';

export function StockCountsPage() {
  const t = useT();
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });

  return (
    <>
      <PageHeader
        title={t.counts.title}
        description={t.counts.description}
        actions={<StartCountForm />}
      />
      {counts.isPending && <Loading />}
      {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
      {counts.data && (
        <DataTable
          caption={t.counts.title}
          rows={counts.data}
          rowKey={(count) => count.id}
          columns={[
            {
              header: t.counts.what,
              cell: (count) => (
                <Link to={`/counts/${count.id}`} className="table__primary-link">
                  {count.category?.name ?? t.counts.wholeShop}
                </Link>
              ),
            },
            { header: t.counts.status, cell: (count) => <StatusPill status={count.status} /> },
            { header: t.counts.startedBy, cell: (count) => count.startedBy?.name ?? t.counts.unknown },
            { header: t.counts.started, cell: (count) => formatDateTime(count.startedAt) },
          ]}
          empty={
            <EmptyState art title={t.counts.none}>
              {t.counts.noneHint}
            </EmptyState>
          }
        />
      )}
    </>
  );
}

function StartCountForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const t = useT();
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [scope, setScope] = useState('');

  const start = useMutation({
    mutationFn: () => stockCountsApi.start(scope === '' ? null : Number(scope)),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
      navigate(`/counts/${count.id}`);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    start.mutate();
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <label className="visually-hidden" htmlFor="count-scope">
        {t.counts.whatToCount}
      </label>
      <select id="count-scope" className="setting-select" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="">{t.counts.theWholeShop}</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
      </select>
      <Button type="submit" variant="primary" icon={ClipboardText} disabled={start.isPending}>
        {start.isPending ? t.counts.starting : t.counts.start}
      </Button>
      {start.isError && (
        <p className="form-error" role="alert">
          {errorMessage(start.error)}
        </p>
      )}
    </form>
  );
}
