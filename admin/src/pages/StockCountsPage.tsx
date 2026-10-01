import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { StatusPill } from '../components/Decision';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { categoriesApi, stockCountsApi } from '../services/api';
import { errorMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';

export function StockCountsPage() {
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: stockCountsApi.list });

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Stock counts</h1>
        <p className="page-intro">
          Count the shelves and compare with what the system expects. Employees count on their phones; you approve the
          differences.
        </p>
      </header>
      <section className="panel">
        <h2 className="panel__title">Start a count</h2>
        <StartCountForm />
      </section>
      <section className="panel" aria-labelledby="counts-heading">
        <h2 id="counts-heading" className="panel__title">
          Counts
        </h2>
        {counts.isPending && <Loading />}
        {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
        {counts.data?.length === 0 && <EmptyState title="No counts yet" />}
        {counts.data && counts.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started by</th>
                  <th scope="col">Started</th>
                </tr>
              </thead>
              <tbody>
                {counts.data.map((count) => (
                  <tr key={count.id}>
                    <td>
                      <Link to={`/counts/${count.id}`} className="table__primary-link">
                        {count.category?.name ?? 'Whole shop'}
                      </Link>
                    </td>
                    <td>
                      <StatusPill status={count.status} />
                    </td>
                    <td>{count.startedBy?.name ?? 'Unknown'}</td>
                    <td>{formatDateTime(count.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
      <label className="inline-field">
        Count
        <select value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="">The whole shop</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="button button--primary" disabled={start.isPending}>
        {start.isPending ? 'Starting…' : 'Start count'}
      </button>
      {start.isError && (
        <p className="form-error" role="alert">
          {errorMessage(start.error)}
        </p>
      )}
    </form>
  );
}
