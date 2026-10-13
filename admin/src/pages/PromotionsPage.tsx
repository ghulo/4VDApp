import { ArrowClockwise, Percent, Plus } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { categoriesApi, productsApi, promotionsApi } from '../services/api';
import type { Promotion, PromotionStatus } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatHeadlineMoney, formatMoney, formatPromotionDay } from '../utils/format';
import { Badge, Button, ButtonLink, Card, DataTable, DateField, EmptyState, Field, MetricCard, MetricGrid, PageHeader, Sheet, StatGrid, StatTile, type Tone } from '../components/ui';
import { useT } from '../i18n/useT';

const STATUS_TONE: Record<PromotionStatus, Tone> = {
  scheduled: 'info',
  running: 'ok',
  finished: 'neutral',
  ended: 'neutral',
};

const VIEWS = ['running', 'scheduled', 'past'] as const;
type View = (typeof VIEWS)[number];
const viewOf = (promotion: Promotion): View =>
  promotion.status === 'running' ? 'running' : promotion.status === 'scheduled' ? 'scheduled' : 'past';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** "2026-10-02" as a UTC day, matching how promotion dates are stored. */
const utcDay = (date: Date) => date.toISOString().slice(0, 10);
const today = () => utcDay(new Date());
const daysFromNow = (days: number) => utcDay(new Date(Date.now() + days * MS_PER_DAY));

/** Quick date ranges for the form, first and last day included. */
const PRESETS = {
  weekend: () => {
    const now = new Date();
    const weekday = now.getUTCDay(); // 0 Sunday … 6 Saturday
    const toSaturday = weekday === 0 ? -1 : 6 - weekday;
    return { startsAt: weekday === 0 || weekday === 6 ? today() : daysFromNow(toSaturday), endsAt: daysFromNow(weekday === 0 ? 0 : 7 - weekday) };
  },
  week: () => ({ startsAt: today(), endsAt: daysFromNow(6) }),
  month: () => {
    const now = new Date();
    return { startsAt: today(), endsAt: utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))) };
  },
} as const;

const targetOf = (promotion: Promotion) => (promotion.product ? `product:${promotion.product.id}` : `category:${promotion.category?.id}`);

function useAppliesTo() {
  const t = useT();
  return (promotion: Promotion) => promotion.product?.name ?? t.promotions.allOf(promotion.category?.name ?? t.promotions.aCategory);
}

/** Promotions as a running list you can judge: what is on, what is coming, and how each did. */
export function PromotionsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { role } = useCurrentUser();
  const manager = canManage(role);
  const appliesTo = useAppliesTo();
  const [params, setParams] = useSearchParams();
  const promotions = useQuery({ queryKey: ['promotions'], queryFn: promotionsApi.list });
  const summary = useQuery({ queryKey: ['promotions', 'summary'], queryFn: promotionsApi.summary });

  const all = promotions.data ?? [];
  const count = (view: View) => all.filter((promotion) => viewOf(promotion) === view).length;
  const view: View = VIEWS.find((key) => key === params.get('show')) ?? (count('running') > 0 || all.length === 0 ? 'running' : count('scheduled') > 0 ? 'scheduled' : 'past');
  const rows = all.filter((promotion) => viewOf(promotion) === view);

  // ?new=1 opens an empty form; ?again=7 opens it filled in from promotion 7.
  const againId = Number(params.get('again')) || null;
  const again = againId === null ? undefined : all.find((promotion) => promotion.id === againId);
  const formOpen = manager && (params.get('new') === '1' || again !== undefined);
  function openForm(from?: Promotion) {
    const next = new URLSearchParams(params);
    next.delete('new');
    next.delete('again');
    if (from) next.set('again', String(from.id));
    else next.set('new', '1');
    setParams(next);
  }
  function closeForm() {
    const next = new URLSearchParams(params);
    next.delete('new');
    next.delete('again');
    setParams(next, { replace: true });
  }
  function showView(key: View) {
    const next = new URLSearchParams(params);
    next.set('show', key);
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader
        title={t.promotions.title}
        description={manager ? t.promotions.description : `${t.promotions.description} ${t.promotions.managersOnly}`}
        actions={
          manager && (
            <Button variant="primary" icon={Plus} onClick={() => openForm()}>
              {t.promotions.new}
            </Button>
          )
        }
      />

      <Sheet open={formOpen} onClose={closeForm} title={again ? t.promotions.again(again.name) : t.promotions.new} description={t.promotions.newHint}>
        <PromotionForm
          key={again?.id ?? 'new'}
          from={again}
          onDone={(created) => {
            closeForm();
            navigate(`/promotions/${created.id}`);
          }}
        />
      </Sheet>

      {promotions.data && summary.data && (
        <StatGrid>
          <StatTile label={t.promotions.runningNow} value={count('running')} />
          <StatTile label={t.promotions.startsLater} value={count('scheduled')} />
          <StatTile label={t.promotions.givenThisMonth} value={formatHeadlineMoney(summary.data.discount)} hint={t.promotions.discountHint} />
          <StatTile
            label={t.promotions.soldThisMonth}
            value={formatHeadlineMoney(summary.data.revenue)}
            hint={summary.data.pieces > 0 ? t.promotions.pieces(summary.data.pieces) : undefined}
          />
        </StatGrid>
      )}

      {promotions.isPending && <Loading />}
      {promotions.isError && <ErrorNotice error={promotions.error} onRetry={() => promotions.refetch()} />}
      {promotions.data && (
        <DataTable<Promotion>
          caption={t.promotions.all}
          rows={rows}
          rowKey={(promotion) => promotion.id}
          onRowClick={(promotion) => navigate(`/promotions/${promotion.id}`)}
          toolbar={
            all.length > 0 && (
              <div className="segmented segmented--small segmented--chips" role="radiogroup" aria-label={t.promotions.show}>
                {VIEWS.map((key) => (
                  <button key={key} type="button" role="radio" aria-checked={view === key} className="segmented__option" onClick={() => showView(key)}>
                    {t.promotions.views[key]}
                    <span className="segmented__count">{count(key)}</span>
                  </button>
                ))}
              </div>
            )
          }
          empty={
            all.length === 0 ? (
              <EmptyState
                icon={Percent}
                title={t.promotions.none}
                action={
                  manager && (
                    <Button variant="primary" icon={Plus} onClick={() => openForm()}>
                      {t.promotions.new}
                    </Button>
                  )
                }
              >
                {t.promotions.noneHint}
              </EmptyState>
            ) : (
              <EmptyState title={t.promotions.noneIn[view]} />
            )
          }
          columns={[
            {
              header: t.promotions.promotion,
              title: true,
              cell: (promotion) => (
                <>
                  <Link to={`/promotions/${promotion.id}`} className="table__primary-link" aria-label={t.promotions.open(promotion.name)}>
                    {promotion.name}
                  </Link>
                  <span className="table__secondary">{appliesTo(promotion)}</span>
                </>
              ),
            },
            { header: t.promotions.discount, align: 'end', cell: (promotion) => `−${promotion.percentOff}%` },
            {
              header: t.promotions.dates,
              cell: (promotion) => (
                <>
                  {formatPromotionDay(promotion.startsAt)} – {formatPromotionDay(promotion.endedEarlyAt ?? promotion.endsAt, !promotion.endedEarlyAt)}
                  {promotion.status !== 'running' && (
                    <span className="table__secondary">
                      <Badge tone={STATUS_TONE[promotion.status]}>{t.promotions.status[promotion.status]}</Badge>
                    </span>
                  )}
                </>
              ),
            },
            {
              header: t.promotions.sold,
              align: 'end',
              cell: (promotion) =>
                promotion.sold.pieces > 0 ? (
                  <>
                    {formatMoney(promotion.sold.revenue)}
                    <span className="table__secondary">{t.promotions.pieces(promotion.sold.pieces)}</span>
                  </>
                ) : (
                  '–'
                ),
            },
            { header: t.promotions.discountGiven, align: 'end', cell: (promotion) => (promotion.sold.discount > 0 ? formatMoney(promotion.sold.discount) : '–') },
            ...(manager
              ? [
                  {
                    header: <span className="visually-hidden">{t.promotions.actions}</span>,
                    align: 'end' as const,
                    cell: (promotion: Promotion) =>
                      viewOf(promotion) === 'past' ? (
                        <Button size="sm" variant="ghost" icon={ArrowClockwise} onClick={() => openForm(promotion)} aria-label={t.promotions.again(promotion.name)}>
                          {t.promotions.runAgain}
                        </Button>
                      ) : (
                        <EndPromotion promotion={promotion} compact />
                      ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}

/** Cancel a scheduled promotion or end a running one early, after one confirm. */
function EndPromotion({ promotion, compact = false }: { promotion: Promotion; compact?: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const end = useMutation({
    mutationFn: () => promotionsApi.end(promotion.id),
    onSuccess: () => {
      for (const key of ['promotions', 'products', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
      setConfirming(false);
    },
  });
  const scheduled = promotion.status === 'scheduled';

  return (
    <span className="inline-confirm">
      {confirming ? (
        <>
          {!compact && <span className="field-hint">{t.promotions.endHint}</span>}
          <Button variant="danger" size={compact ? 'sm' : undefined} disabled={end.isPending} onClick={() => end.mutate()}>
            {scheduled ? t.promotions.confirmCancel : t.promotions.confirmEnd}
          </Button>
          <Button variant="ghost" size={compact ? 'sm' : undefined} onClick={() => setConfirming(false)}>
            {t.promotions.keep}
          </Button>
        </>
      ) : (
        <Button variant="danger-text" size={compact ? 'sm' : undefined} onClick={() => setConfirming(true)}>
          {scheduled ? t.promotions.cancel : t.promotions.endNow}
        </Button>
      )}
      {end.isError && (
        <span className="form-error" role="alert">
          {errorMessage(end.error)}
        </span>
      )}
    </span>
  );
}

const PREVIEW_SHOWN = 40;

/** A new promotion, or `from` an earlier one run again with new dates, with every new price shown before it starts. */
function PromotionForm({ from, onDone }: { from?: Promotion; onDone: (created: Promotion) => void }) {
  const queryClient = useQueryClient();
  const t = useT();
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const products = useQuery({
    queryKey: ['products', 'all-for-promotions'],
    queryFn: () => productsApi.list({ page: 1, limit: 100 }),
  });

  const [name, setName] = useState(from?.name ?? '');
  const [percentOff, setPercentOff] = useState(from ? String(from.percentOff) : '');
  const [target, setTarget] = useState(from ? targetOf(from) : '');
  const [dates, setDates] = useState(PRESETS.week);

  const percent = Number(percentOff);
  const percentValid = percent > 0 && percent <= 90;
  const [kind, targetId] = target.split(':');
  const targetInput = kind === 'product' ? { productId: Number(targetId) } : { categoryId: Number(targetId) };
  const preview = useQuery({
    queryKey: ['promotions', 'preview', percent, target],
    queryFn: () => promotionsApi.preview({ percentOff: percent, ...targetInput }),
    enabled: percentValid && target !== '',
    placeholderData: keepPreviousData,
  });
  const lines = percentValid && target !== '' ? (preview.data ?? []) : [];
  const tooLow = lines.filter((line) => line.tooLow).length;

  const create = useMutation({
    mutationFn: () => promotionsApi.create({ name: name.trim(), percentOff: percent, ...targetInput, ...dates }),
    onSuccess: (created) => {
      for (const key of ['promotions', 'products', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
      onDone(created);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const isValid = name.trim() !== '' && target !== '' && percentValid && dates.startsAt !== '' && dates.endsAt >= dates.startsAt && tooLow === 0;

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="field-row">
        <Field label={t.promotions.name}>
          <input required maxLength={255} placeholder={t.promotions.namePlaceholder} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t.promotions.discountPercent} narrow>
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
        </Field>
      </div>
      <Field label={t.promotions.appliesTo}>
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
      </Field>
      <Field label={t.promotions.quick}>
        <div className="promo-dates">
          {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((key) => (
            <Button key={key} size="sm" onClick={() => setDates(PRESETS[key]())}>
              {t.promotions.presets[key]}
            </Button>
          ))}
        </div>
      </Field>
      <div className="field-row">
        <Field label={t.promotions.firstDay}>
          <DateField required value={dates.startsAt} onChange={(value) => setDates({ ...dates, startsAt: value })} />
        </Field>
        <Field label={t.promotions.lastDay}>
          <DateField required min={dates.startsAt} value={dates.endsAt} onChange={(value) => setDates({ ...dates, endsAt: value })} />
        </Field>
      </div>

      <section className="promo-preview" aria-labelledby="promo-preview-title" aria-live="polite">
        <h3 id="promo-preview-title" className="subheading">
          {t.promotions.preview}
          {lines.length > 0 && <span className="table__secondary">{t.promotions.previewCount(lines.length)}</span>}
        </h3>
        {lines.length === 0 ? (
          <p className="field-hint">{preview.isFetching ? t.common.loading : t.promotions.previewHint}</p>
        ) : (
          <>
            {tooLow > 0 && (
              <p className="form-error" role="alert">
                {t.promotions.tooLowCount(tooLow)}
              </p>
            )}
            <ul className="promo-preview__list" aria-label={t.promotions.previewCaption}>
              {[...lines]
                .sort((a, b) => Number(b.tooLow) - Number(a.tooLow))
                .slice(0, PREVIEW_SHOWN)
                .map((line) => (
                  <li key={line.id} className="promo-preview__row">
                    <span className="promo-preview__name">{line.name}</span>
                    <span className="promo-preview__prices">
                      <s aria-label={`${t.promotions.price}: ${formatMoney(line.price)}`}>{formatMoney(line.price)}</s>
                      <strong>{formatMoney(line.newPrice)}</strong>
                    </span>
                    <span className="promo-preview__meta">
                      {line.tooLow && <Badge tone="danger">{t.promotions.tooLow}</Badge>}
                      {line.profitEach === null ? t.promotions.unknownCost : `${t.promotions.profitEach}: ${formatMoney(line.profitEach)}`}
                    </span>
                  </li>
                ))}
            </ul>
            {lines.length > PREVIEW_SHOWN && <p className="field-hint">{t.promotions.moreProducts(lines.length - PREVIEW_SHOWN)}</p>}
          </>
        )}
        {preview.isError && <ErrorNotice error={preview.error} onRetry={() => preview.refetch()} />}
      </section>

      <p className="field-hint">{t.promotions.marginHint}</p>
      {create.isError && (
        <p className="form-error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
      <Button type="submit" disabled={!isValid || create.isPending} variant="primary" loading={create.isPending}>
        {t.promotions.start}
      </Button>
    </form>
  );
}

/** One promotion: what sold at its price, and whether what it covers sold better than before it. */
export function PromotionDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const { role } = useCurrentUser();
  const appliesTo = useAppliesTo();
  const results = useQuery({ queryKey: ['promotions', id, 'results'], queryFn: () => promotionsApi.results(id) });

  if (results.isPending) return <Loading />;
  if (results.isError) return <ErrorNotice error={results.error} onRetry={() => results.refetch()} />;
  const { promotion, days, during, before, daily } = results.data;
  const change = (now: number, then: number) => (then > 0 ? now / then - 1 : null);
  const live = promotion.status === 'running' || promotion.status === 'scheduled';
  const dayName = (day: string) => formatDateWith(new Date(`${day}T12:00:00Z`), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const highest = Math.max(...daily.map((entry) => entry.revenue), 0);

  return (
    <>
      <PageHeader
        title={promotion.name}
        description={[
          `−${promotion.percentOff}%`,
          appliesTo(promotion),
          `${formatPromotionDay(promotion.startsAt)} – ${formatPromotionDay(promotion.endedEarlyAt ?? promotion.endsAt, !promotion.endedEarlyAt)}`,
          t.promotions.status[promotion.status],
          promotion.createdBy && t.promotions.by(promotion.createdBy),
        ]
          .filter(Boolean)
          .join(' · ')}
        crumbs={[{ label: t.nav.items.promotions, to: '/promotions' }]}
        actions={
          canManage(role) &&
          (live ? (
            <EndPromotion promotion={promotion} />
          ) : (
            <ButtonLink to={`/promotions?again=${promotion.id}`} icon={ArrowClockwise}>
              {t.promotions.runAgain}
            </ButtonLink>
          ))
        }
      />

      {promotion.status === 'scheduled' ? (
        <Card>
          <EmptyState icon={Percent} title={t.promotions.notStarted(formatPromotionDay(promotion.startsAt))} />
        </Card>
      ) : (
        <>
          <MetricGrid>
            <MetricCard label={t.promotions.results} value={t.promotions.pieces(promotion.sold.pieces)} />
            <MetricCard label={t.promotions.revenue} value={formatHeadlineMoney(promotion.sold.revenue)} />
            <MetricCard label={t.promotions.discountGiven} value={formatHeadlineMoney(promotion.sold.discount)} hint={t.promotions.discountHint} />
            <MetricCard label={t.promotions.profit} value={formatHeadlineMoney(promotion.sold.profit)} hint={t.promotions.profitHint} />
          </MetricGrid>

          <Card title={t.promotions.compare} description={t.promotions.compareHint(days)}>
            <div className="promo-days">
              <MetricGrid>
                <MetricCard
                  label={t.promotions.coveredRevenue}
                  value={formatHeadlineMoney(during.revenue)}
                  change={change(during.revenue, before.revenue)}
                  hint={t.promotions.beforeWas(formatMoney(before.revenue))}
                />
                <MetricCard
                  label={t.promotions.coveredPieces}
                  value={during.pieces}
                  change={change(during.pieces, before.pieces)}
                  hint={t.promotions.beforeWas(String(before.pieces))}
                />
              </MetricGrid>
              <p className="promo-days__legend" aria-hidden="true">
                <span className="promo-days__key">{t.promotions.legendBefore}</span>
                <span className="promo-days__key promo-days__key--during">{t.promotions.legendDuring}</span>
              </p>
              <ol className="promo-days__bars" aria-label={t.promotions.daily}>
                {daily.map((entry) => {
                  const label = (entry.during ? t.promotions.dayDuring : t.promotions.dayBefore)(dayName(entry.day), formatMoney(entry.revenue));
                  return (
                    <li
                      key={entry.day}
                      className={entry.during ? 'promo-days__bar promo-days__bar--during' : 'promo-days__bar'}
                      style={{ height: highest > 0 ? `${(entry.revenue / highest) * 100}%` : undefined }}
                      title={label}
                    >
                      <span className="visually-hidden">{label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
