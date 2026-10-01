import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { StockTag } from '../components/StockTag';
import { useCurrentUser } from '../auth/useAuth';
import { inventoryApi, productsApi } from '../services/api';

export function OverviewPage() {
  const user = useCurrentUser();
  const lowStock = useQuery({
    queryKey: ['inventory', { lowStock: true, page: 1, limit: 50 }],
    queryFn: () => inventoryApi.list({ page: 1, lowStock: true, limit: 50 }),
  });
  const products = useQuery({
    queryKey: ['products', { page: 1 }],
    queryFn: () => productsApi.list({ page: 1 }),
  });

  const firstName = user.name.split(' ')[0];
  const lowCount = lowStock.data?.meta.total;
  const outCount = lowStock.data?.items.filter((item) => item.quantity === 0).length;

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Hi {firstName}</h1>
        <p className="page-intro">
          {lowCount === undefined
            ? 'Checking stock levels…'
            : lowCount === 0
              ? `All ${products.data?.meta.total ?? ''} products are above their reorder level.`
              : `${lowCount} ${lowCount === 1 ? 'product needs' : 'products need'} restocking${outCount ? `, ${outCount} already sold out` : ''}.`}
        </p>
      </header>

      <section className="panel" aria-labelledby="restock-heading">
        <div className="panel__header">
          <h2 id="restock-heading" className="panel__title">
            Needs restocking
          </h2>
          <Link to="/inventory?lowStock=true" className="text-link">
            See all stock
          </Link>
        </div>

        {lowStock.isPending && <Loading />}
        {lowStock.isError && <ErrorNotice error={lowStock.error} onRetry={() => lowStock.refetch()} />}
        {lowStock.data && lowStock.data.items.length === 0 && (
          <EmptyState title="Nothing to restock">Every product has more than its reorder level.</EmptyState>
        )}
        {lowStock.data && lowStock.data.items.length > 0 && (
          <ul className="restock-list">
            {lowStock.data.items.map((item) => (
              <li key={item.productId}>
                <Link to={`/inventory/${item.productId}`} className="restock-list__row">
                  <StockTag quantity={item.quantity} reorderLevel={item.reorderLevel} />
                  <span className="restock-list__name">{item.productName}</span>
                  <span className="restock-list__meta">Reorder at {item.reorderLevel}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
