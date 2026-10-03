import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { categoriesApi, productsApi, promotionsApi } from '../services/api';
import type { Promotion, PromotionStatus } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatPromotionDay } from '../utils/format';
import { Badge, Button, Card, PageHeader, type Tone } from '../components/ui';
import { ManagersOnly } from '../components/ManagersOnly';
import { useT } from '../i18n/useT';

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
  const t = useT();
  const promotions = useQuery({ queryKey: ['promotions'], queryFn: promotionsApi.list });

  return (
    <>
      <PageHeader
        title={t.promotions.title}
        description={t.promotions.description}
      />

      <ManagersOnly note={t.promotions.managersOnly}>
        <Card title={t.promotions.new}>
          <PromotionForm />
        </Card>

        {promotions.isPending && <Loading />}
        {promotions.isError && <ErrorNotice error={promotions.error} onRetry={() => promotions.refetch()} />}
        {promotions.data && promotions.data.length === 0 && (
          <EmptyState title={t.promotions.none}>{t.promotions.noneHint}</EmptyState>
        )}
        {promotions.data && promotions.data.length > 0 && (
          <Card title={t.promotions.all} flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t.promotions.promotion}</th>
                    <th scope="col">{t.promotions.appliesTo}</th>
                    <th scope="col" className="table__numeric">{t.promotions.discount}</th>
                    <th scope="col">{t.promotions.dates}</th>
                    <th scope="col">{t.promotions.status_}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t.promotions.actions}</span>
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
  const t = useT();
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
        {promotion.createdBy && <span className="table__secondary">{t.promotions.by(promotion.createdBy)}</span>}
      </td>
      <td>{promotion.product ? promotion.product.name : t.promotions.allOf(promotion.category?.name ?? t.promotions.aCategory)}</td>
      <td className="table__numeric">−{promotion.percentOff}%</td>
      <td>
        {formatPromotionDay(promotion.startsAt)} – {formatPromotionDay(promotion.endsAt, true)}
      </td>
      <td>
        <Badge tone={STATUS_TONE[promotion.status]}>{t.promotions.status[promotion.status]}</Badge>
      </td>
      <td>
        {isLive && (
          <Button variant="danger-text" disabled={end.isPending} onClick={() => end.mutate()}>
            {promotion.status === 'scheduled' ? t.promotions.cancel : t.promotions.endNow}
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
  const t = useT();
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
          <span className="field__label">{t.promotions.name}</span>
          <input required maxLength={255} placeholder={t.promotions.namePlaceholder} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field field--narrow">
          <span className="field__label">{t.promotions.discountPercent}</span>
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
        <span className="field__label">{t.promotions.appliesTo}</span>
        <select required value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">{t.promotions.choose}</option>
          <optgroup label={t.promotions.wholeCategory}>
            {categories.data?.map((category) => (
              <option key={category.id} value={`category:${category.id}`}>
                {category.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={t.promotions.oneProduct}>
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
          <span className="field__label">{t.promotions.firstDay}</span>
          <input type="date" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{t.promotions.lastDay}</span>
          <input type="date" required min={startsAt} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </label>
      </div>
      <p className="field-hint">{t.promotions.marginHint}</p>
      {create.isError && (
        <p className="form-error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
      <Button type="submit" disabled={!isValid || create.isPending} variant="primary">
        {create.isPending ? t.promotions.saving : t.promotions.start}
      </Button>
    </form>
  );
}
