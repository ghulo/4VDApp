import { Plus } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { Badge, Button, ButtonLink, Card, Combobox, DataTable, DateField, EmptyState, Field, PageHeader, Section, Sheet, StatGrid, StatTile, useNewSheet, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { makesApi } from '../services/api';
import type { MakePlan, ProductUnit } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatMoney, formatQuantity } from '../utils/format';
import { useLocations } from '../utils/useLocations';
import { usePeriodParams } from '../utils/usePeriodParams';

/** "2026-10-04": today on this computer's calendar. */
const today = () => new Date().toLocaleDateString('en-CA');

/** "Sat 4 Oct" for a "2026-10-04" day, without any time zone moving it. */
const formatDay = (day: string) => formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const STALE_KEYS = ['makes', 'products', 'inventory', 'reports', 'locations', 'expiring', 'activity'];

/**
 * Products made here from other products, like gift baskets: one list with
 * the period picker, and Make, which takes the parts out of a location and
 * puts the made product in at what the parts cost. No books entry: both sit
 * in stock.
 */
export function MakesPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const { period, from, to, range, rangeKey, changePeriod } = usePeriodParams('this-month');
  const makes = useQuery({ queryKey: ['makes', rangeKey], queryFn: () => makesApi.list(rangeKey), placeholderData: keepPreviousData });
  const [params] = useSearchParams();
  const productParam = params.get('product');
  const [adding, setAdding] = useNewSheet();
  const live = (makes.data ?? []).filter((row) => !row.voidedAt);

  return (
    <>
      <PageHeader
        title={t.makes.title}
        description={t.makes.description(range.label)}
        actions={
          canOversee(role) && (
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              {t.makes.add}
            </Button>
          )
        }
      />
      <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
      {makes.data && (
        <StatGrid compact>
          <StatTile label={t.makes.count} value={String(live.length)} />
          <StatTile label={t.makes.units} value={String(live.reduce((sum, row) => sum + row.quantity, 0))} />
          <StatTile label={t.makes.value} value={formatMoney(live.reduce((sum, row) => sum + row.value, 0))} />
        </StatGrid>
      )}
      {makes.isPending && <Loading />}
      {makes.isError && <ErrorNotice error={makes.error} onRetry={() => makes.refetch()} />}
      {makes.data && (
        <Section title={t.makes.list}>
          <DataTable
            caption={t.makes.caption}
            rows={makes.data}
            rowKey={(row) => row.id}
            empty={<EmptyState title={t.makes.none}>{t.makes.noneHint}</EmptyState>}
            columns={[
              {
                header: t.makes.number,
                title: true,
                cell: (row) => (
                  <>
                    <Link to={`/makes/${row.id}`}>{row.number}</Link>
                    {row.note && <span className="table__secondary">{row.note}</span>}
                  </>
                ),
              },
              { header: t.makes.day, cell: (row) => formatDay(row.day) },
              {
                header: t.makes.made,
                cell: (row) =>
                  row.voidedAt ? (
                    <Badge tone="neutral">{t.makes.voided}</Badge>
                  ) : (
                    <>
                      {formatQuantity(row.quantity, row.unit)} × {row.productName}
                    </>
                  ),
              },
              { header: t.makes.costEach, cell: (row) => formatMoney(row.unitCost), align: 'end', className: 'table__phone-hide' },
              { header: t.makes.value, cell: (row) => formatMoney(row.value), align: 'end' },
              { header: t.makes.by, cell: (row) => row.createdBy ?? '–', className: 'table__phone-hide' },
            ]}
          />
        </Section>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title={t.makes.add}>
        <MakeForm initialProduct={productParam ? Number(productParam) : null} onSaved={() => setAdding(false)} />
      </Sheet>
    </>
  );
}

/** Joins "10 × Rakia", "10 × Honey" into "10 × Rakia and 10 × Honey". */
function joinList(items: string[], and: string): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

/** The sentence said before saving: what comes out, where, and what goes in at what cost. */
function previewOf(plan: MakePlan, t: ReturnType<typeof useT>): string {
  const parts = plan.parts.map((part) => `${formatQuantity(part.needed, part.unit)} × ${part.name}`);
  return t.makes.preview(joinList(parts, t.makes.and), plan.locationName, `${formatQuantity(plan.quantity, plan.unit)} × ${plan.productName}`, formatMoney(plan.unitCost ?? 0));
}

/** Make: the product, how many, where, the day and its best-before; a sentence says what it will do. */
function MakeForm({ initialProduct, onSaved }: { initialProduct: number | null; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { locations, several, receiving } = useLocations();
  const products = useQuery({ queryKey: ['makes', 'products'], queryFn: makesApi.madeProducts });
  const [productId, setProductId] = useState<number | null>(initialProduct);
  const [quantity, setQuantity] = useState('1');
  const [locationId, setLocationId] = useState<number | null>(receiving?.id ?? null);
  const [day, setDay] = useState(today);
  // Left alone, the best-before follows the earliest of the parts; typing one replaces it.
  const [typedExpiry, setTypedExpiry] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const count = Number(quantity.replace(',', '.'));
  const countOk = count > 0 && Number.isInteger(count);
  const plan = useQuery({
    queryKey: ['makes', 'plan', productId, count, locationId],
    queryFn: () => makesApi.plan({ productId: productId!, quantity: count, locationId }),
    enabled: productId !== null && countOk,
    placeholderData: keepPreviousData,
  });
  const ready = plan.data && plan.data.productId === productId ? plan.data : null;

  const earliest = ready?.earliestExpiry ?? null;
  const expiresOn = typedExpiry ?? earliest ?? '';

  const quantityError = quantity === '' ? undefined : !(count > 0) ? t.makes.quantityError : !Number.isInteger(count) ? t.makes.wholeError : undefined;
  const blocked = ready ? ready.noCost.length > 0 || ready.short.length > 0 : true;
  const valid = productId !== null && countOk && day !== '' && day <= today() && !blocked && !plan.isFetching;

  const save = useMutation({
    mutationFn: () => makesApi.create({ productId: productId!, quantity: count, day, locationId: ready?.locationId ?? locationId, expiresOn: expiresOn || null, note: note.trim() || null }),
    onSuccess: (make) => {
      for (const key of STALE_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: t.makes.saved(make.number) });
      onSaved();
      navigate(`/makes/${make.id}`);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  if (products.isPending) return <Loading />;
  if (products.isError) return <ErrorNotice error={products.error} onRetry={() => products.refetch()} />;
  if (products.data.length === 0) return <EmptyState title={t.makes.noRecipes}>{t.makes.noRecipesHint}</EmptyState>;

  const options = products.data.map((product) => ({ value: String(product.productId), label: product.name }));
  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Combobox label={t.makes.product} placeholder={t.makes.findProduct} required value={productId === null ? '' : String(productId)} options={options} onChange={(picked) => setProductId(picked ? Number(picked) : null)} />
      <div className="field-row">
        <Field label={t.makes.quantity} narrow error={quantityError}>
          <input type="number" inputMode="numeric" min={1} step={1} required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label={t.makes.day}>
          <DateField required max={today()} value={day} onChange={(next) => setDay(next)} />
        </Field>
      </div>
      {several && (
        <Field label={t.makes.location}>
          <select value={locationId ?? ready?.locationId ?? ''} onChange={(event) => setLocationId(Number(event.target.value))}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t.makes.expiresOn} hint={earliest && expiresOn === earliest ? t.makes.expiresHint : undefined}>
        <DateField
          value={expiresOn}
          onChange={(next) => setTypedExpiry(next)}
        />
      </Field>
      <Field label={t.makes.note}>
        <input maxLength={500} placeholder={t.makes.notePlaceholder} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {plan.isError && (
        <p className="form-error" role="alert">
          {errorMessage(plan.error)}
        </p>
      )}
      {ready && ready.noCost.length > 0 && (
        <p className="form-error" role="alert">
          {t.makes.noCost(joinList(ready.noCost, t.makes.and))}
        </p>
      )}
      {ready && ready.short.length > 0 && (
        <p className="form-error" role="alert">
          {t.makes.short(joinList(ready.short, t.makes.and))}
        </p>
      )}
      {ready && !blocked && (
        <p className="notice" aria-live="polite">
          {previewOf(ready, t)}
        </p>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
          {t.makes.save}
        </Button>
      </div>
    </form>
  );
}

/** One Make: what it made, the parts it used, and Void for those who oversee. */
export function MakePage() {
  const t = useT();
  const { id } = useParams();
  const { role } = useCurrentUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const make = useQuery({ queryKey: ['makes', 'one', Number(id)], queryFn: () => makesApi.get(Number(id)) });
  const voiding = useMutation({
    mutationFn: () => makesApi.void(Number(id)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['makes', 'one', Number(id)], updated);
      for (const key of STALE_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: t.makes.voidedToast(updated.number) });
      setConfirming(false);
    },
  });

  if (make.isPending) return <Loading />;
  if (make.isError) return <ErrorNotice error={make.error} onRetry={() => make.refetch()} />;
  const doc = make.data;
  const lines = doc.lines ?? [];
  const at = (iso: string) => formatDateWith(new Date(iso), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const facts = [formatDay(doc.day), doc.locationName, doc.expiresOn ? `${t.makes.expiresOn} ${formatDay(doc.expiresOn)}` : null].filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader
        title={doc.number}
        crumbs={[{ to: '/makes', label: t.makes.title }]}
        description={facts}
        meta={doc.voidedAt && <Badge tone="neutral">{t.makes.voided}</Badge>}
      />
      <StatGrid compact>
        <StatTile label={t.makes.made} value={`${formatQuantity(doc.quantity, doc.unit)} × ${doc.productName}`} />
        <StatTile label={t.makes.costEach} value={formatMoney(doc.unitCost)} />
        <StatTile label={t.makes.value} value={formatMoney(doc.value)} />
      </StatGrid>
      <Card title={t.makes.parts} actions={<ButtonLink size="sm" variant="ghost" to={`/products/${doc.productId}`}>{doc.productName}</ButtonLink>}>
        <DataTable
          caption={t.makes.linesCaption(doc.number)}
          rows={lines}
          rowKey={(row) => row.productId}
          columns={[
            { header: t.makes.part, title: true, cell: (row) => <Link to={`/products/${row.productId}`}>{row.productName}</Link> },
            { header: t.makes.partQuantity, cell: (row) => formatQuantity(row.quantity, row.unit as ProductUnit), align: 'end' },
            { header: t.makes.costEach, cell: (row) => formatMoney(row.unitCost), align: 'end' },
          ]}
        />
        {doc.note && <p className="field-hint">{doc.note}</p>}
        <p className="field-hint">
          {t.makes.madeBy(doc.createdBy ?? '–', at(doc.createdAt))}
          {doc.voidedAt && ` ${t.makes.voidedBy(doc.voidedBy ?? '–', at(doc.voidedAt))}`}
        </p>
        {canOversee(role) && !doc.voidedAt && (
          <div className="form-actions">
            {confirming ? (
              <>
                <Button variant="danger" loading={voiding.isPending} disabled={voiding.isPending} onClick={() => voiding.mutate()}>
                  {t.makes.confirmVoid}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  {t.common.cancel}
                </Button>
              </>
            ) : (
              <Button variant="danger-text" onClick={() => setConfirming(true)}>
                {t.makes.void}
              </Button>
            )}
          </div>
        )}
        {confirming && <p className="field-hint">{t.makes.voidHint}</p>}
        {voiding.isError && (
          <p className="form-error" role="alert">
            {errorMessage(voiding.error)}
          </p>
        )}
      </Card>
    </>
  );
}
