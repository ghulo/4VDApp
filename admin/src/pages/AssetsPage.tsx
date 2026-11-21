import { DownloadSimple, Plus } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { canWriteEntries } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { EntriesPanel } from '../components/BooksParts';
import { ChipChoice } from '../components/ChipChoice';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PlaceSelect, placeName } from '../components/MoneyParts';
import {
  Badge,
  Button,
  Card,
  Combobox,
  DataTable,
  DateField,
  EmptyState,
  Field,
  MenuButton,
  PageHeader,
  RemoveButton,
  Section,
  Sheet,
  StatGrid,
  StatTile,
  type Tone,
  useNewSheet,
  useToast,
} from '../components/ui';
import { useLanguage, useT } from '../i18n/useT';
import { assetsApi, customersApi, moneyApi } from '../services/api';
import { ASSET_CATEGORIES, type AssetCategory, type AssetStatus, DEFAULT_ASSET_RATES, type FixedAsset, type FixedAssetDetail } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatMoney } from '../utils/format';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';

/** "2026-10-04": today on this computer's calendar. */
const today = () => new Date().toLocaleDateString('en-CA');

/** "4 Oct 2026" for a "2026-10-04" day, without any time zone moving it. */
const formatDay = (day: string) => formatDateWith(new Date(`${day}T00:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Oct 2026" for a month's first day. */
const formatMonth = (month: string) => formatDateWith(new Date(`${month}T00:00:00Z`), { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Typed amounts take a comma or a point. */
const amountOf = (text: string) => Number(text.replace(',', '.'));

const STATUS_TONE: Record<AssetStatus, Tone> = { in_use: 'ok', worn_out: 'neutral', sold: 'info', scrapped: 'neutral', returned: 'neutral' };

type Filter = 'owned' | 'left' | 'all';

/** Books → Fixed assets: everything the business owns, what it is worth now, the year's depreciation and the check against the books. */
export function AssetsPage() {
  const t = useT();
  const w = t.assets;
  const { role } = useCurrentUser();
  const { language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get('show') === 'left' || params.get('show') === 'all' ? (params.get('show') as Filter) : 'owned';
  const assets = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const [adding, setAdding] = useNewSheet();
  const download = useMutation({ mutationFn: (what: 'register' | { year: number }) => assetsApi.download(what, language) });

  const all = assets.data ?? [];
  const owned = all.filter((asset) => !asset.disposal);
  const shown = filter === 'owned' ? owned : filter === 'left' ? all.filter((asset) => asset.disposal) : all;
  const sum = (pick: (asset: FixedAsset) => number, rows = owned) => rows.reduce((total, asset) => total + pick(asset), 0);
  const thisMonth = sum((asset) => (asset.status === 'in_use' && asset.place === 'shop' ? asset.monthly : 0));

  function choose(next: Filter) {
    const nextParams = new URLSearchParams(params);
    if (next === 'owned') nextParams.delete('show');
    else nextParams.set('show', next);
    setParams(nextParams, { replace: true });
  }

  return (
    <>
      <PageHeader
        title={w.title}
        description={w.description}
        actions={
          canWriteEntries(role) && (
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              {w.add}
            </Button>
          )
        }
      />
      {assets.isPending && <Loading />}
      {assets.isError && <ErrorNotice error={assets.error} onRetry={() => assets.refetch()} />}
      {assets.data && (
        <>
          <StatGrid compact>
            <StatTile label={w.tiles.cost} value={formatMoney(sum((asset) => asset.cost))} />
            <StatTile label={w.tiles.depreciated} value={formatMoney(sum((asset) => asset.depreciated))} />
            <StatTile label={w.tiles.value} value={formatMoney(sum((asset) => asset.value))} />
            <StatTile label={w.tiles.month} value={thisMonth > 0 ? formatMoney(thisMonth) : undefined} words={thisMonth > 0 ? undefined : w.tiles.noMonth} />
          </StatGrid>
          <DataTable
            caption={w.caption}
            rows={shown}
            rowKey={(row) => row.id}
            toolbar={
              <div className="toolbar">
                <ChipChoice
                  label={w.show}
                  value={filter}
                  options={(['owned', 'left', 'all'] as const).map((value) => ({ value, label: w.filters[value] }))}
                  onChange={choose}
                />
                <div className="toolbar__end">
                  <MenuButton
                    label={download.isPending ? t.common.downloading : t.common.download}
                    icon={DownloadSimple}
                    items={[
                      { label: w.downloadRegister, onSelect: () => download.mutate('register') },
                      { label: w.downloadSchedule(new Date().getFullYear()), onSelect: () => download.mutate({ year: new Date().getFullYear() }) },
                    ]}
                  />
                </div>
              </div>
            }
            empty={
              <EmptyState title={filter === 'left' ? w.noneLeft : w.none}>{filter === 'left' ? w.noneLeftHint : w.noneHint}</EmptyState>
            }
            columns={[
              {
                header: w.name,
                title: true,
                cell: (row) => (
                  <>
                    <Link to={`/books/assets/${row.id}`}>{row.name}</Link>
                    <span className="table__secondary">{[w.categories[row.category], row.code, row.place === 'carwash' ? w.carwash : null].filter(Boolean).join(' · ')}</span>
                  </>
                ),
              },
              { header: w.inUseFrom, cell: (row) => formatDay(row.inUseFrom), className: 'table__phone-hide' },
              { header: w.rate, cell: (row) => w.ratePercent(row.rate), align: 'end', className: 'table__phone-hide' },
              { header: w.cost, cell: (row) => formatMoney(row.cost), align: 'end' },
              { header: w.depreciated, cell: (row) => formatMoney(row.depreciated), align: 'end', className: 'table__phone-hide' },
              { header: w.value, cell: (row) => (row.disposal ? '–' : formatMoney(row.value)), align: 'end' },
              { header: w.status, cell: (row) => <AssetStatusCell asset={row} /> },
            ]}
            totals={[
              t.common.total,
              '',
              '',
              formatMoney(sum((asset) => asset.cost, shown)),
              formatMoney(sum((asset) => asset.depreciated, shown)),
              formatMoney(sum((asset) => (asset.disposal ? 0 : asset.value), shown)),
              '',
            ]}
          />
          {download.isError && (
            <p className="form-error" role="alert">
              {errorMessage(download.error)}
            </p>
          )}
          <ScheduleSection />
          <BooksCheckSection />
        </>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title={w.add}>
        <AssetForm onSaved={() => setAdding(false)} />
      </Sheet>
    </>
  );
}

function AssetStatusCell({ asset }: { asset: FixedAsset }) {
  const w = useT().assets;
  if (asset.status === 'in_use' && asset.wornOutIn) return <span>{w.wornOutBy(formatMonth(asset.wornOutIn))}</span>;
  return <Badge tone={STATUS_TONE[asset.status]}>{w.statuses[asset.status]}</Badge>;
}

/** The year's depreciation for each asset: worth at the start, bought, depreciation, left, worth at the end. */
function ScheduleSection() {
  const t = useT();
  const w = t.assets.schedule;
  const { language } = useLanguage();
  const thisYear = new Date().getFullYear();
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('year'));
  const year = asked >= thisYear - 2 && asked <= thisYear ? asked : thisYear;
  const setYear = (next: number) =>
    setParams((now) => {
      const out = new URLSearchParams(now);
      if (next === thisYear) out.delete('year');
      else out.set('year', String(next));
      return out;
    }, { replace: true });
  const schedule = useQuery({ queryKey: ['assets', 'schedule', year], queryFn: () => assetsApi.schedule(year), placeholderData: keepPreviousData });
  const download = useMutation({ mutationFn: () => assetsApi.download({ year }, language) });
  const rows = schedule.data ?? [];
  const total = (pick: (row: (typeof rows)[number]) => number) => formatMoney(rows.reduce((sum, row) => sum + pick(row), 0));
  const years = [thisYear - 2, thisYear - 1, thisYear];

  return (
    <Section title={w.title} description={w.description}>
      {schedule.isError && <ErrorNotice error={schedule.error} onRetry={() => schedule.refetch()} />}
      <DataTable
        caption={w.caption(year)}
        rows={rows}
        rowKey={(row) => row.id}
        toolbar={
          <div className="toolbar">
            <ChipChoice label={w.year} value={String(year)} options={years.map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => setYear(Number(value))} />
            <div className="toolbar__end">
              <Button variant="secondary" icon={DownloadSimple} loading={download.isPending} disabled={download.isPending || rows.length === 0} onClick={() => download.mutate()}>
                {t.common.excelFile}
              </Button>
            </div>
          </div>
        }
        empty={<EmptyState title={w.none(year)}>{w.noneHint}</EmptyState>}
        columns={[
          {
            header: t.assets.name,
            title: true,
            cell: (row) => (
              <>
                <Link to={`/books/assets/${row.id}`}>{row.name}</Link>
                <span className="table__secondary">{[t.assets.categories[row.category], t.assets.ratePercent(row.rate)].join(' · ')}</span>
              </>
            ),
          },
          { header: w.openingValue, cell: (row) => formatMoney(row.openingValue), align: 'end' },
          { header: w.added, cell: (row) => formatMoney(row.added), align: 'end', className: 'table__phone-hide' },
          { header: w.depreciation, cell: (row) => formatMoney(row.depreciation), align: 'end' },
          { header: w.disposedValue, cell: (row) => formatMoney(row.disposedValue), align: 'end', className: 'table__phone-hide' },
          { header: w.closingValue, cell: (row) => formatMoney(row.closingValue), align: 'end' },
        ]}
        totals={[
          t.common.total,
          total((row) => row.openingValue),
          total((row) => row.added),
          total((row) => row.depreciation),
          total((row) => row.disposedValue),
          total((row) => row.closingValue),
        ]}
      />
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
    </Section>
  );
}

/** The register's figures next to what the asset accounts hold, kind by kind. */
function BooksCheckSection() {
  const t = useT();
  const w = t.assets.check;
  const check = useQuery({ queryKey: ['assets', 'check'], queryFn: assetsApi.booksCheck });
  if (check.isPending) return null;
  if (check.isError) return <ErrorNotice error={check.error} onRetry={() => check.refetch()} />;
  const off = (row: (typeof check.data)[number]) => Math.round((row.cost - row.booksCost) * 100) !== 0 || Math.round((row.depreciated - row.booksDepreciated) * 100) !== 0;

  return (
    <Section title={w.title} description={w.description}>
      <DataTable
        caption={w.title}
        rows={check.data}
        rowKey={(row) => row.category}
        empty={<EmptyState title={w.none}>{w.noneHint}</EmptyState>}
        columns={[
          { header: t.assets.kind, title: true, cell: (row) => t.assets.categories[row.category] },
          { header: w.cost, cell: (row) => formatMoney(row.cost), align: 'end' },
          { header: w.booksCost(''), cell: (row) => <span title={row.costAccount}>{formatMoney(row.booksCost)}</span>, align: 'end' },
          { header: w.depreciated, cell: (row) => formatMoney(row.depreciated), align: 'end', className: 'table__phone-hide' },
          { header: w.booksDepreciated, cell: (row) => formatMoney(row.booksDepreciated), align: 'end', className: 'table__phone-hide' },
          { header: w.result, cell: (row) => (off(row) ? <Badge tone="warn">{w.differs}</Badge> : <Badge tone="ok">{w.matches}</Badge>) },
        ]}
      />
      {check.data.some(off) && <p className="field-hint">{w.differsHint}</p>}
    </Section>
  );
}

interface FormState {
  name: string;
  code: string;
  category: AssetCategory;
  boughtOn: string;
  inUseFrom: string;
  cost: string;
  residual: string;
  rate: string;
  openingDepreciated: string;
  note: string;
}

/** Typing in something already owned (new), or changing an asset (edit): the fields the asset still lets change are open. */
function AssetForm({ asset, onSaved }: { asset?: FixedAssetDetail; onSaved: () => void }) {
  const t = useT();
  const w = t.assets.form;
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = asset !== undefined;
  const fromBill = asset?.bill !== null && asset !== undefined;
  const started = editing && !asset.canChangeStart;
  const [form, setForm] = useState<FormState>(() => ({
    name: asset?.name ?? '',
    code: asset?.code ?? '',
    category: asset?.category ?? 'equipment',
    boughtOn: asset?.boughtOn ?? today(),
    inUseFrom: asset?.inUseFrom ?? today(),
    cost: asset ? String(asset.cost) : '',
    residual: asset ? String(asset.residual) : '0',
    rate: asset ? String(asset.rate) : '',
    openingDepreciated: asset ? String(asset.openingDepreciated) : '',
    note: asset?.note ?? '',
  }));
  const set = (patch: Partial<FormState>) => setForm((now) => ({ ...now, ...patch }));
  const [touched, setTouched] = useState(false);

  const cost = amountOf(form.cost);
  const residual = form.residual.trim() === '' ? 0 : amountOf(form.residual);
  const rate = form.category === 'land' ? 0 : form.rate.trim() === '' ? DEFAULT_ASSET_RATES[form.category] : amountOf(form.rate);
  const suggestion = useQuery({
    queryKey: ['assets', 'opening', form.category, cost, residual, rate, form.inUseFrom],
    queryFn: () => assetsApi.suggestedOpening({ category: form.category, cost, residual, rate, inUseFrom: form.inUseFrom }),
    enabled: !editing && cost > 0 && form.inUseFrom !== '',
  });

  const problems = {
    name: form.name.trim() === '' ? w.nameError : null,
    cost: !(cost > 0) ? w.costError : null,
    residual: !(residual >= 0) || residual >= cost ? w.residualError : null,
    rate: !(rate >= 0 && rate <= 100) ? w.rateError : null,
    inUseFrom: form.inUseFrom < form.boughtOn ? w.inUseError : null,
    boughtOn: form.boughtOn > today() ? w.futureError : null,
  };
  const valid = Object.values(problems).every((problem) => problem === null);

  const save = useMutation({
    mutationFn: () => {
      const opening = form.openingDepreciated.trim() === '' ? null : amountOf(form.openingDepreciated);
      if (asset) {
        return assetsApi.update(asset.id, {
          name: form.name.trim(),
          code: form.code.trim() || null,
          note: form.note.trim() || null,
          rate,
          residual,
          ...(!started && { inUseFrom: form.inUseFrom }),
          ...(!fromBill && { boughtOn: form.boughtOn, cost, ...(opening !== null && { openingDepreciated: opening }) }),
          ...(!fromBill && !started && { category: form.category }),
        });
      }
      return assetsApi.create({
        name: form.name.trim(),
        code: form.code.trim() || null,
        category: form.category,
        boughtOn: form.boughtOn,
        inUseFrom: form.inUseFrom,
        cost,
        residual,
        rate,
        openingDepreciated: opening,
        place: 'shop',
        note: form.note.trim() || null,
      });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(['assets', 'one', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      toast({ title: editing ? w.savedEdit(saved.name) : w.saved(saved.name) });
      setTouched(false);
      onSaved();
      if (!editing) navigate(`/books/assets/${saved.id}`);
    },
  });
  // Not while saving or once saved: moving on to the saved record isn't leaving work behind.
  useWarnBeforeLeaving(touched && !save.isPending && !save.isSuccess);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  const change = (patch: Partial<FormState>) => {
    setTouched(true);
    set(patch);
  };

  return (
    <form className="settings-form" onSubmit={handleSubmit} onChange={() => setTouched(true)}>
      {!editing && <p className="notice">{w.ownedHint}</p>}
      <div className="field-row">
        <Field label={w.name} error={touched ? (problems.name ?? undefined) : undefined}>
          <input required autoComplete="off" maxLength={200} value={form.name} placeholder={w.namePlaceholder} onChange={(event) => change({ name: event.target.value })} />
        </Field>
        <Field label={w.code} hint={w.codeHint}>
          <input autoComplete="off" spellCheck={false} maxLength={60} value={form.code} onChange={(event) => change({ code: event.target.value })} />
        </Field>
      </div>
      <Field label={w.kind} hint={fromBill ? w.fromBillLocked : started ? w.startedLocked : w.kindHint(DEFAULT_ASSET_RATES[form.category])}>
        <select value={form.category} disabled={fromBill || started} onChange={(event) => change({ category: event.target.value as AssetCategory, rate: '' })}>
          {ASSET_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t.assets.categories[category]}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-row">
        <Field label={w.boughtOn} error={problems.boughtOn ?? undefined}>
          <DateField required max={today()} disabled={fromBill} value={form.boughtOn} onChange={(next) => change({ boughtOn: next })} />
        </Field>
        <Field label={w.inUseFrom} hint={started ? w.startedLocked : w.inUseHint} error={problems.inUseFrom ?? undefined}>
          <DateField required disabled={started} value={form.inUseFrom} onChange={(next) => change({ inUseFrom: next })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label={w.cost} hint={fromBill ? w.fromBillLocked : w.costHint} error={touched ? (problems.cost ?? undefined) : undefined}>
          <input inputMode="decimal" required disabled={fromBill} value={form.cost} onChange={(event) => change({ cost: event.target.value })} />
        </Field>
        <Field label={w.rate} hint={form.category === 'land' ? w.landHint : w.rateHint(DEFAULT_ASSET_RATES[form.category])} error={problems.rate ?? undefined}>
          <input
            inputMode="decimal"
            disabled={form.category === 'land'}
            placeholder={String(DEFAULT_ASSET_RATES[form.category])}
            value={form.category === 'land' ? '0' : form.rate}
            onChange={(event) => change({ rate: event.target.value })}
          />
        </Field>
      </div>
      <Field label={w.residual} hint={w.residualHint} error={problems.residual ?? undefined}>
        <input inputMode="decimal" value={form.residual} onChange={(event) => change({ residual: event.target.value })} />
      </Field>
      {!fromBill && (
        <Field label={w.opening} hint={w.openingHint}>
          <input
            inputMode="decimal"
            placeholder={suggestion.data === undefined ? '' : String(suggestion.data)}
            value={form.openingDepreciated}
            onChange={(event) => change({ openingDepreciated: event.target.value })}
          />
        </Field>
      )}
      {!editing && suggestion.data !== undefined && form.openingDepreciated.trim() === '' && (
        <p className="field-hint" aria-live="polite">
          {w.openingSuggested(formatMoney(suggestion.data))}
        </p>
      )}
      <Field label={w.note}>
        <input autoComplete="off" maxLength={500} value={form.note} onChange={(event) => change({ note: event.target.value })} />
      </Field>
      {cost > 0 && rate > 0 && residual < cost && (
        <p className="notice" aria-live="polite">
          {w.preview(formatMoney(Math.round(((cost - residual) * rate) / 12) / 100), Math.ceil(100 / rate))}
        </p>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
          {editing ? t.common.save : w.add}
        </Button>
      </div>
    </form>
  );
}

/** One line of an asset's facts: what it is on the left, the value on the right. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Sold or thrown away: the day, and for a sale the price with VAT, the buyer and where the money went. */
function DisposeForm({ asset, onSaved }: { asset: FixedAssetDetail; onSaved: () => void }) {
  const t = useT();
  const w = t.assets.dispose;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'sold' | 'scrapped'>('sold');
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState('');
  const [vatRate, setVatRate] = useState<0 | 8 | 18>(18);
  const [buyerName, setBuyerName] = useState('');
  const [buyerNui, setBuyerNui] = useState('');
  const [pickedPlaceId, setPaidPlaceId] = useState<number | null>(null);
  const [onTab, setOnTab] = useState(false);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const places = useQuery({ queryKey: ['money', 'places'], queryFn: moneyApi.places });
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list, enabled: onTab });

  // The shop till until something else is picked.
  const paidPlaceId = pickedPlaceId ?? places.data?.find((place) => place.kind === 'till' && !place.carwashId && !place.archived)?.id ?? null;

  const gross = amountOf(amount);
  const vat = Math.round(((gross * vatRate) / (100 + vatRate)) * 100) / 100;
  const net = Math.round((gross - vat) * 100) / 100;
  const result = Math.round(((kind === 'sold' ? net : 0) + asset.depreciated - asset.cost) * 100) / 100;
  const valid =
    day !== '' && day <= today() && day >= asset.boughtOn && (kind === 'scrapped' || (gross >= 0 && amount.trim() !== '' && (onTab ? customerId !== null : paidPlaceId !== null)));

  const save = useMutation({
    mutationFn: () =>
      assetsApi.dispose(asset.id, {
        kind,
        day,
        amount: kind === 'sold' ? gross : null,
        vatRate: kind === 'sold' ? vatRate : null,
        buyerName: kind === 'sold' ? buyerName.trim() || null : null,
        buyerNui: kind === 'sold' ? buyerNui.trim() || null : null,
        customerId: kind === 'sold' && onTab ? customerId : null,
        paidPlaceId: kind === 'sold' && !onTab ? paidPlaceId : null,
        note: note.trim() || null,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['assets', 'one', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['vat'] });
      toast({ title: kind === 'sold' ? w.soldToast(saved.name) : w.scrappedToast(saved.name) });
      onSaved();
    },
  });
  // Not while saving or once saved: moving on to the saved record isn't leaving work behind.
  useWarnBeforeLeaving((amount !== '' || note !== '') && !save.isPending && !save.isSuccess);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <ChipChoice label={w.what} value={kind} options={(['sold', 'scrapped'] as const).map((value) => ({ value, label: w.kinds[value] }))} onChange={setKind} />
      <Field label={w.day} hint={w.dayHint}>
        <DateField required min={asset.boughtOn} max={today()} value={day} onChange={setDay} />
      </Field>
      {kind === 'sold' && (
        <>
          <div className="field-row">
            <Field label={w.amount} hint={w.amountHint}>
              <input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} />
            </Field>
            <Field label={w.vatRate}>
              <select value={vatRate} onChange={(event) => setVatRate(Number(event.target.value) as 0 | 8 | 18)}>
                {([18, 8, 0] as const).map((rate) => (
                  <option key={rate} value={rate}>
                    {w.rate(rate)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={onTab} onChange={(event) => setOnTab(event.target.checked)} />
            {w.onTab}
          </label>
          {onTab ? (
            <Combobox
              label={w.customer}
              placeholder={w.findCustomer}
              value={customerId === null ? '' : String(customerId)}
              options={(customers.data ?? []).map((customer) => ({ value: String(customer.id), label: customer.name }))}
              onChange={(picked) => setCustomerId(picked ? Number(picked) : null)}
            />
          ) : (
            <>
              <Field label={w.paidInto}>
                {places.data ? <PlaceSelect places={places.data} value={paidPlaceId} onChange={setPaidPlaceId} required /> : <select disabled aria-busy="true" />}
              </Field>
              <div className="field-row">
                <Field label={w.buyer}>
                  <input autoComplete="off" maxLength={200} value={buyerName} onChange={(event) => setBuyerName(event.target.value)} />
                </Field>
                <Field label={w.buyerNui} hint={w.buyerNuiHint}>
                  <input autoComplete="off" spellCheck={false} maxLength={40} inputMode="numeric" value={buyerNui} onChange={(event) => setBuyerNui(event.target.value)} />
                </Field>
              </div>
            </>
          )}
        </>
      )}
      <Field label={w.note}>
        <input autoComplete="off" maxLength={500} value={note} placeholder={kind === 'scrapped' ? w.scrappedPlaceholder : undefined} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {(kind === 'scrapped' || amount.trim() !== '') && (
        <p className="notice" aria-live="polite">
          {w.preview(formatMoney(asset.cost), formatMoney(asset.depreciated), formatMoney(Math.abs(result)), result >= 0)}
          {kind === 'sold' && vat > 0 && ` ${w.previewVat(formatMoney(vat))}`}
          {` ${w.previewMonth}`}
        </p>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
          {kind === 'sold' ? w.saveSold : w.saveScrapped}
        </Button>
      </div>
    </form>
  );
}

/** One asset: what it cost, how it wears out month by month, and selling, splitting or removing it. */
export function AssetPage() {
  const t = useT();
  const w = t.assets;
  const { id } = useParams();
  const { role } = useCurrentUser();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useNewSheet();
  const [disposing, setDisposing] = useState(false);
  const [pieces, setPieces] = useState('2');
  const [allMonths, setAllMonths] = useState(false);
  const asset = useQuery({ queryKey: ['assets', 'one', Number(id)], queryFn: () => assetsApi.get(Number(id)) });
  const places = useQuery({ queryKey: ['money', 'places'], queryFn: moneyApi.places, enabled: Boolean(asset.data?.disposal?.paidPlaceId) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['books'] });
    queryClient.invalidateQueries({ queryKey: ['vat'] });
  };
  const undo = useMutation({
    mutationFn: () => assetsApi.undoDisposal(Number(id)),
    onSuccess: (saved) => {
      queryClient.setQueryData(['assets', 'one', saved.id], saved);
      refresh();
      toast({ title: w.backToast(saved.name) });
    },
  });
  const split = useMutation({
    mutationFn: () => assetsApi.split(Number(id), Number(pieces)),
    onSuccess: (made) => {
      refresh();
      toast({ title: w.splitToast(made.length) });
    },
  });
  const remove = useMutation({
    mutationFn: () => assetsApi.remove(Number(id)),
    onSuccess: () => {
      refresh();
      toast({ title: w.removedToast(asset.data?.name ?? '') });
      navigate('/books/assets');
    },
  });

  if (asset.isPending) return <Loading />;
  if (asset.isError) return <ErrorNotice error={asset.error} onRetry={() => asset.refetch()} />;
  const a = asset.data;
  const writer = canWriteEntries(role);
  const disposal = a.disposal;
  const place = disposal?.paidPlaceId ? places.data?.find((one) => one.id === disposal.paidPlaceId) : undefined;
  const plan = allMonths ? a.plan : a.plan.slice(0, 12);
  const monthRows = [...a.months.map((month) => ({ ...month, done: true })), ...plan.map((month) => ({ ...month, done: false }))];
  const error = undo.error ?? split.error ?? remove.error;

  return (
    <>
      <PageHeader
        title={a.name}
        crumbs={[{ to: '/books/assets', label: w.title }]}
        description={[w.categories[a.category], a.code, a.place === 'carwash' ? w.carwash : null].filter(Boolean).join(' · ')}
        actions={
          <>
            <Badge tone={STATUS_TONE[a.status]}>{w.statuses[a.status]}</Badge>
            {writer && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {w.edit}
              </Button>
            )}
          </>
        }
      />
      <StatGrid compact>
        <StatTile label={w.cost} value={formatMoney(a.cost)} />
        <StatTile label={w.depreciated} value={formatMoney(a.depreciated)} />
        <StatTile label={w.value} value={disposal ? undefined : formatMoney(a.value)} words={disposal ? w.statuses[a.status] : undefined} />
        <StatTile
          label={w.month}
          value={a.monthly > 0 && !disposal && a.status === 'in_use' ? formatMoney(a.monthly) : undefined}
          words={a.category === 'land' ? w.landWords : disposal || a.status !== 'in_use' ? w.noMoreMonths : undefined}
        />
      </StatGrid>
      <Card title={w.about}>
        <dl className="partner-facts">
          <Fact label={w.boughtOn}>{formatDay(a.boughtOn)}</Fact>
          <Fact label={w.inUseFrom}>{formatDay(a.inUseFrom)}</Fact>
          <Fact label={w.rate}>{a.category === 'land' ? w.landWords : w.rateYears(a.rate, a.rate > 0 ? Math.ceil(100 / a.rate) : 0)}</Fact>
          {a.residual > 0 && (
            <>
              <Fact label={w.residual}>{formatMoney(a.residual)}</Fact>
            </>
          )}
          {a.wornOutIn && (
            <>
              <Fact label={a.status === 'worn_out' ? w.wornOutIn : w.wornOutBySoon}>{formatMonth(a.wornOutIn)}</Fact>
            </>
          )}
          <Fact label={w.from}>
            {a.bill ? (
              <Link to={`/bills/${a.bill.id}`}>{w.fromBill([a.bill.supplier, a.bill.number].filter(Boolean).join(' ') || `#${a.bill.id}`)}</Link>
            ) : (
              w.typedIn(formatMoney(a.openingDepreciated))
            )}
          </Fact>
          {a.note && (
            <>
              <Fact label={w.note}>{a.note}</Fact>
            </>
          )}
        </dl>
        {a.small && a.bill && !disposal && <p className="field-hint">{w.smallHint}</p>}
        {a.place === 'carwash' && <p className="field-hint">{w.carwashHint}</p>}
        {writer && !disposal && (
          <div className="form-actions">
            <Button variant="primary" onClick={() => setDisposing(true)}>
              {w.sellOrRemove}
            </Button>
            {a.bill && a.canChangeStart && (
              <span className="inline-form">
                <Field label={w.splitInto} narrow>
                  <input type="number" min={2} max={100} step={1} value={pieces} onChange={(event) => setPieces(event.target.value)} />
                </Field>
                <Button variant="secondary" loading={split.isPending} disabled={split.isPending || !(Number(pieces) >= 2 && Number(pieces) <= 100)} onClick={() => split.mutate()}>
                  {w.split}
                </Button>
              </span>
            )}
            {!a.bill && <RemoveButton confirm={w.confirmRemove} onConfirm={() => remove.mutate()} pending={remove.isPending}>
                {w.remove}
              </RemoveButton>}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {errorMessage(error)}
          </p>
        )}
      </Card>
      {disposal && (
        <Card title={w.left}>
          <dl className="partner-facts">
            <Fact label={w.leftOn}>{`${w.disposalKinds[disposal.kind]}, ${formatDay(disposal.day)}`}</Fact>
            {disposal.kind === 'sold' && (
              <>
                <Fact label={w.soldFor}>{w.soldForWords(formatMoney((disposal.net ?? 0) + (disposal.vat ?? 0)), formatMoney(disposal.vat ?? 0), disposal.vatRate ?? 0)}</Fact>
                {disposal.buyer && (
                  <>
                    <Fact label={w.buyer}>{[disposal.buyer, disposal.buyerNui].filter(Boolean).join(' · ')}</Fact>
                  </>
                )}
                <Fact label={w.moneyTo}>{place ? placeName(t, place) : disposal.customerId ? <Link to={`/customers/${disposal.customerId}`}>{w.onTheirTab}</Link> : '–'}</Fact>
              </>
            )}
            {disposal.creditBill && (
              <>
                <Fact label={w.credit}>
                  <Link to={`/bills/${disposal.creditBill.id}`}>{disposal.creditBill.number ?? `#${disposal.creditBill.id}`}</Link>
                </Fact>
              </>
            )}
            {disposal.kind !== 'returned' && (
              <>
                <Fact label={w.result}>{disposal.result >= 0 ? w.gain(formatMoney(disposal.result)) : w.loss(formatMoney(-disposal.result))}</Fact>
              </>
            )}
            {disposal.note && (
              <>
                <Fact label={w.note}>{disposal.note}</Fact>
              </>
            )}
          </dl>
          {writer && disposal.kind !== 'returned' && (
            <div className="form-actions">
              <Button variant="secondary" loading={undo.isPending} disabled={undo.isPending} onClick={() => undo.mutate()}>
                {w.undo}
              </Button>
            </div>
          )}
          {disposal.kind === 'returned' && <p className="field-hint">{w.returnedHint}</p>}
        </Card>
      )}
      <Section title={w.months} description={w.monthsHint}>
        <DataTable
          caption={w.monthsCaption(a.name)}
          rows={monthRows}
          rowKey={(row) => `${row.month}-${row.done}`}
          empty={<EmptyState title={a.category === 'land' ? w.landWords : w.noMonths}>{a.category === 'land' ? null : w.noMonthsHint}</EmptyState>}
          columns={[
            { header: w.monthLabel, title: true, cell: (row) => formatMonth(row.month) },
            { header: w.amount, cell: (row) => formatMoney(row.amount), align: 'end' },
            { header: w.state, cell: (row) => (row.done ? <Badge tone="ok">{w.posted}</Badge> : <span>{w.toCome}</span>) },
          ]}
        />
        {a.plan.length > 12 && (
          <Button variant="ghost" aria-expanded={allMonths} onClick={() => setAllMonths((now) => !now)}>
            {allMonths ? w.fewerMonths : w.allMonths(a.plan.length)}
          </Button>
        )}
      </Section>
      {disposal && <EntriesPanel source="asset" id={a.id} />}
      <Sheet open={editing} onClose={() => setEditing(false)} title={w.editTitle(a.name)}>
        <AssetForm asset={a} onSaved={() => setEditing(false)} />
      </Sheet>
      <Sheet open={disposing} onClose={() => setDisposing(false)} title={w.sellOrRemove}>
        <DisposeForm asset={a} onSaved={() => setDisposing(false)} />
      </Sheet>
    </>
  );
}
