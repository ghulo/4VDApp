import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { categoriesApi, productsApi, promotionsApi } from '../services/api';
import type { Promotion, PromotionStatus } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatPromotionDay } from '../utils/format';
import { Badge, Button, Card, PageHeader, type Tone } from '../components/ui';
import { ManagersOnly } from '../components/ManagersOnly';

const STATUS_LABEL: Record<PromotionStatus, string> = {
  scheduled: 'Starts later',
  running: 'Running',
  finished: 'Finished',
  ended: 'Ended early',
};

const STATUS_TONE: Record<PromotionStatus, Tone> = {
  scheduled: 'info',
  running: 'ok',
  finished: 'neutral',
  ended: 'neutral',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** "2026-10-02": today as a UTC day, matching how promotion dates are stored. */
const today = () => new Date().toISOString().slice(0, 10);

export function PromotionsPage() {
  const promotions = useQuery({ queryKey: ['promotions'], queryFn: promotionsApi.list });

  return (
    <>
      <PageHeader
        title="Promotions"
        description="A discount for one product or a whole category. It applies by itself to every sale while it runs, and prices go back when it ends. Discounts never stack, and bulk prices win when they're cheaper."
      />

      <ManagersOnly note="Only the developer or an admin can start or end promotions.">
        <Card title="New promotion">
          <PromotionForm />
        </Card>

        {promotions.isPending && <Loading />}
        {promotions.isError && <ErrorNotice error={promotions.error} onRetry={() => promotions.refetch()} />}
        {promotions.data && promotions.data.length === 0 && (
          <EmptyState title="No promotions yet">Create one above, e.g. 15% off Lighting for a week.</EmptyState>
        )}
        {promotions.data && promotions.data.length > 0 && (
          <Card title="All promotions" flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Promotion</th>
                    <th scope="col">Applies to</th>
                    <th scope="col" className="table__numeric">Discount</th>
                    <th scope="col">Dates</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.data.map((promotion) => (
                    <PromotionRow key={promotion.id} promotion={promotion} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </ManagersOnly>
    </>
  );
}

function PromotionRow({ promotion }: { promotion: Promotion }) {
  const queryClient = useQueryClient();
  const end = useMutation({
    mutationFn: () => promotionsApi.end(promotion.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
  const isLive = promotion.status === 'running' || promotion.status === 'scheduled';

  return (
    <tr className={isLive ? undefined : 'table__row--muted'}>
      <td>
        <span className="table__primary-link">{promotion.name}</span>
        {promotion.createdBy && <span className="table__secondary">by {promotion.createdBy}</span>}
      </td>
      <td>{promotion.product ? promotion.product.name : `All of ${promotion.category?.name ?? 'a category'}`}</td>
      <td className="table__numeric">−{promotion.percentOff}%</td>
      <td>
        {formatPromotionDay(promotion.startsAt)} – {formatPromotionDay(promotion.endsAt, true)}
      </td>
      <td>
        <Badge tone={STATUS_TONE[promotion.status]}>{STATUS_LABEL[promotion.status]}</Badge>
      </td>
      <td>
        {isLive && (
          <Button variant="danger-text" disabled={end.isPending} onClick={() => end.mutate()}>
            {promotion.status === 'scheduled' ? 'Cancel' : 'End now'}
          </Button>
        )}
        {end.isError && (
          <p className="form-error" role="alert">
            {errorMessage(end.error)}
          </p>
        )}
      </td>
    </tr>
  );
}

function PromotionForm() {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const products = useQuery({
    queryKey: ['products', 'all-for-promotions'],
    queryFn: () => productsApi.list({ page: 1, limit: 100 }),
  });

  const [name, setName] = useState('');
  const [percentOff, setPercentOff] = useState('');
  const [target, setTarget] = useState('');
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(() => new Date(Date.now() + 6 * MS_PER_DAY).toISOString().slice(0, 10));

  const create = useMutation({
    mutationFn: () => {
      const [kind, id] = target.split(':');
      return promotionsApi.create({
        name: name.trim(),
        percentOff: Number(percentOff),
        ...(kind === 'product' ? { productId: Number(id) } : { categoryId: Number(id) }),
        startsAt,
        endsAt,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setName('');
      setPercentOff('');
      setTarget('');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const percent = Number(percentOff);
  const isValid = name.trim() !== '' && target !== '' && percent > 0 && percent <= 90 && startsAt !== '' && endsAt >= startsAt;

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">Name</span>
          <input required maxLength={255} placeholder="Autumn sale" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field field--narrow">
          <span className="field__label">Discount (%)</span>
          <input
            type="number"
            inputMode="decimal"
            required
            min={1}
            max={90}
            step={1}
            value={percentOff}
            onChange={(event) => setPercentOff(event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span className="field__label">Applies to</span>
        <select required value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Choose a category or product…</option>
          <optgroup label="Whole category">
            {categories.data?.map((category) => (
              <option key={category.id} value={`category:${category.id}`}>
                {category.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="One product">
            {products.data?.items.map((product) => (
              <option key={product.id} value={`product:${product.id}`}>
                {product.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field__label">First day</span>
          <input type="date" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Last day</span>
          <input type="date" required min={startsAt} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </label>
      </div>
      <p className="field-hint">
        A discount that would take any product below cost plus your minimum margin (see Settings) is refused.
      </p>
      {create.isError && (
        <p className="form-error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
      <Button type="submit" disabled={!isValid || create.isPending} variant="primary">
        {create.isPending ? 'Saving…' : 'Start promotion'}
      </Button>
    </form>
  );
}
