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

export function StockCountsPage() {
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });

  return (
    <>
      <PageHeader
        title="Stock counts"
        description="Count the shelves and compare with what the system expects. Employees count on their phones; you approve the differences."
        actions={<StartCountForm />}
      />
      {counts.isPending && <Loading />}
      {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
      {counts.data && (
        <DataTable
          caption="Stock counts"
          rows={counts.data}
          rowKey={(count) => count.id}
          columns={[
            {
              header: 'What',
              cell: (count) => (
                <Link to={`/counts/${count.id}`} className="table__primary-link">
                  {count.category?.name ?? 'Whole shop'}
                </Link>
              ),
            },
            { header: 'Status', cell: (count) => <StatusPill status={count.status} /> },
            { header: 'Started by', cell: (count) => count.startedBy?.name ?? 'Unknown' },
            { header: 'Started', cell: (count) => formatDateTime(count.startedAt) },
          ]}
          empty={
            <EmptyState art title="No counts yet">
              Start one above. Employees then count on their phones, and you approve any differences here.
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
        What to count
      </label>
      <select id="count-scope" className="setting-select" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="">The whole shop</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
      </select>
      <Button type="submit" variant="primary" icon={ClipboardText} disabled={start.isPending}>
        {start.isPending ? 'Starting…' : 'Start count'}
      </Button>
      {start.isError && (
        <p className="form-error" role="alert">
          {errorMessage(start.error)}
        </p>
      )}
    </form>
  );
}
