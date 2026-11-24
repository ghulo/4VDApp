import { FilePdf, FileXls, LockSimple, Plus, X } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { cardPath, formatBookDay } from '../components/BooksParts';
import { ChipChoice } from '../components/ChipChoice';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PlaceSelect, placeInSentence } from '../components/MoneyParts';
import { Badge, Button, Card, DateField, Field, MenuButton, PageHeader, Sheet, StatGrid, StatTile, SwapText, type Tone } from '../components/ui';
import { useLanguage, useT } from '../i18n/useT';
import { useSetUp } from '../auth/useSetUp';
import { booksApi, moneyApi } from '../services/api';
import { canPayTax, type Declaration, type DeclarationAccount, type DeclarationInputs, declarationApi, statementsApi } from '../services/statements';
import { todayIso } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { printHtml } from '../utils/printPage';

const STATUS_TONE: Record<Declaration['status'], Tone> = { not_over: 'neutral', to_file: 'warn', late: 'danger', filed: 'ok' };

/** Which year: from the address, else last year (the one to file). */
function useDeclarationYear(): [number, (year: number) => void] {
  const [params, setParams] = useSearchParams();
  const thisYear = Number(todayIso().slice(0, 4));
  const asked = Number(params.get('year'));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= thisYear ? asked : thisYear - 1;
  return [
    year,
    (next: number) => {
      const nextParams = new URLSearchParams(params);
      nextParams.set('year', String(next));
      setParams(nextParams, { replace: true });
    },
  ];
}

/** Focus the first key of a confirm row when it opens. */
function useFocusFirst(open: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector('button')?.focus();
  }, [open]);
  return ref;
}

/** The yearly declaration to ATK: the CD for a company, the PD for an individual business, read from the books. */
export function DeclarationPage() {
  const t = useT();
  const w = t.declaration;
  const { language } = useLanguage();
  const { role } = useCurrentUser();
  const [year, setYear] = useDeclarationYear();
  const settings = useQuery({ queryKey: ['books', 'settings'], queryFn: booksApi.settings });
  const view = useQuery({ queryKey: ['books', 'declaration', year], queryFn: () => declarationApi.get(year), placeholderData: keepPreviousData });
  const thisYear = Number(todayIso().slice(0, 4));
  const firstYear = Math.min(thisYear - 1, Number(settings.data?.startDay?.slice(0, 4) ?? thisYear));
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, index) => firstYear + index);
  const print = useMutation({ mutationFn: async () => printHtml(await declarationApi.page(year, language), `${view.data?.form ?? ''} ${year}`) });
  const excel = useMutation({ mutationFn: () => declarationApi.downloadXlsx(year, language) });
  const canEdit = canPayTax(role);

  return (
    <>
      <PageHeader
        title={t.nav.tabs.declaration}
        description={w.description}
        actions={
          view.data && (
            <MenuButton
              label={w.downloads.label}
              variant="secondary"
              loading={print.isPending || excel.isPending}
              items={[
                { label: w.downloads.xlsx, icon: FileXls, onSelect: () => excel.mutate() },
                { label: w.downloads.print, icon: FilePdf, onSelect: () => print.mutate() },
              ]}
            />
          )
        }
      />
      <ChipChoice className="statements-years" label={w.yearLabel} value={String(year)} options={years.map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => setYear(Number(value))} />
      {(print.isError || excel.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(print.error ?? excel.error)}
        </p>
      )}
      {view.isPending && <Loading />}
      {view.isError && <ErrorNotice error={view.error} onRetry={() => view.refetch()} />}
      {view.data && (
        <div className="declaration" aria-busy={view.isFetching}>
          <Summary data={view.data} />
          <div className="declaration__layout">
            <Figures data={view.data} />
            <div className="declaration__side">
              {/* New figures from the server start the typed fields again. */}
              <Inputs key={JSON.stringify(view.data.inputs) + view.data.status} data={view.data} canEdit={canEdit} />
              <Filing data={view.data} canEdit={canEdit} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Summary({ data }: { data: Declaration }) {
  const t = useT();
  const { role } = useCurrentUser();
  const w = t.declaration;
  const paid = data.instalmentsTotal + (data.restPayment?.amount ?? 0);
  const status =
    data.status === 'filed' && data.filed
      ? w.status.filed(formatBookDay(data.filed.on))
      : data.status === 'to_file'
        ? w.status.to_file(formatBookDay(data.due))
        : data.status === 'late'
          ? w.status.late(formatBookDay(data.due))
          : w.status.not_over;
  return (
    <section className="declaration__summary" aria-labelledby="declaration-form">
      <div className="declaration__form">
        <p className="declaration__code" aria-hidden="true" translate="no">
          {data.form}
        </p>
        <div>
          <h2 id="declaration-form" className="declaration__name">
            {w.forms[data.form]} · {data.year}
          </h2>
          <p className="declaration__why">
            {w.formWhy[data.form]}{canManage(role) && (
              <>
                {" "}
                <Link to="/settings/shop">{w.changeForm}</Link>
              </>
            )}
          </p>
        </div>
        <Badge tone={STATUS_TONE[data.status]}>
          {data.status === 'filed' && <LockSimple size={12} aria-hidden="true" />} {status}
        </Badge>
      </div>
      {data.status === 'not_over' && (
        <p className="notice" role="status">
          {w.notOver(data.year)}
        </p>
      )}
      <StatGrid compact>
        <StatTile label={w.stats.taxable} value={formatMoney(data.taxable)} />
        <StatTile label={w.stats.tax} value={formatMoney(data.tax)} />
        <StatTile label={w.stats.paid} value={formatMoney(paid)} />
        <StatTile label={data.left < 0 ? w.stats.overpaid : w.stats.left} value={formatMoney(Math.abs(data.left))} tone={data.left > 0 && data.status === 'late' ? 'danger' : 'default'} />
      </StatGrid>
    </section>
  );
}

/** The declaration as a ledger: income, costs, book profit, what is added back, losses, taxable profit, tax and what was paid. */
function Figures({ data }: { data: Declaration }) {
  const t = useT();
  const setUp = useSetUp();
  const w = t.declaration.figures;
  const search = `?period=custom&from=${data.year}-01-01&to=${data.year}-12-31`;
  const accounts = (list: DeclarationAccount[]) =>
    list.length > 0 && (
      <ul className="declaration__accounts">
        {list.map((account) => (
          <li key={account.accountId}>
            <Link to={cardPath(account.accountId, search)}>
              <span className="declaration__no">{account.number}</span> {account.name}
            </Link>
            <span className="declaration__amount">{formatMoney(account.amount)}</span>
          </li>
        ))}
      </ul>
    );
  const row = (label: string, amount: number, kind: 'line' | 'sub' | 'total' = 'line', extra?: ReactNode, note?: string) => (
    <div className={`declaration__row declaration__row--${kind}`}>
      <span className="declaration__label">
        {label}
        {note && <span className="declaration__note"> · {note}</span>}
      </span>
      <span className="declaration__amount">{formatMoney(amount)}</span>
      {extra && <div className="declaration__more">{extra}</div>}
    </div>
  );
  const shown = <T extends { amount: number; key: string }>(lines: T[]) => lines.filter((line) => line.amount !== 0 || line.key === 'sales' || (setUp.carwash && line.key.startsWith('carwash')));
  const addBacks = data.adjustments.filter((line) => line.amount !== 0);
  const used = data.losses.filter((loss) => loss.used > 0);

  return (
    <Card className="declaration__figures" title={w.title} description={w.caption(data.form, data.year)}>
      <div className="declaration__ledger">
        <h3 className="declaration__head">{w.income}</h3>
        {shown(data.income.lines).map((line) => (
          <div key={line.key} className="declaration__row declaration__row--line">
            <span className="declaration__label">
              {w.lines[line.key]}
              {line.key === 'carwash_takings' && <span className="declaration__note"> · {w.outsideBooks}</span>}
            </span>
            <span className="declaration__amount">{formatMoney(line.amount)}</span>
            {line.accounts.length > 1 && <div className="declaration__more">{accounts(line.accounts)}</div>}
          </div>
        ))}
        {row(w.totalIncome, data.income.total, 'sub')}
        <h3 className="declaration__head">{w.costs}</h3>
        {shown(data.costs.lines).map((line) => (
          <div key={line.key} className="declaration__row declaration__row--line">
            <span className="declaration__label">
              {w.lines[line.key]}
              {line.key === 'carwash_costs' && <span className="declaration__note"> · {w.outsideBooks}</span>}
            </span>
            <span className="declaration__amount">{formatMoney(line.amount)}</span>
            {line.accounts.length > 1 && <div className="declaration__more">{accounts(line.accounts)}</div>}
          </div>
        ))}
        {row(w.totalCosts, data.costs.total, 'sub')}
        {data.profitBeforeBooks !== 0 && data.startsInYear && row(w.profitBeforeBooks(formatBookDay(data.startsInYear)), data.profitBeforeBooks)}
        {row(w.bookProfit, data.bookProfit, 'total')}
        {addBacks.length > 0 && (
          <>
            <h3 className="declaration__head">{w.addedBack}</h3>
            {addBacks.map((line, index) => (
              <Fragment key={`${line.key}-${index}`}>{row(line.key === 'other' ? line.label ?? w.adjustments.other : w.adjustments[line.key], line.amount)}</Fragment>
            ))}
            {row(w.adjustedProfit, data.adjustedProfit, 'sub')}
          </>
        )}
        {used.length > 0 && (
          <>
            <h3 className="declaration__head">{w.losses}</h3>
            {used.map((loss) => (
              <Fragment key={loss.year}>{row(w.lossOf(loss.year), -loss.used)}</Fragment>
            ))}
          </>
        )}
        {row(w.taxable, data.taxable, 'total')}
        <h3 className="declaration__head">{w.tax}</h3>
        {data.form === 'CD'
          ? row(w.flat(`${data.taxParts[0]?.rate ?? 10}%`), data.tax)
          : data.taxParts.map((part) => (
              <Fragment key={part.from}>{row(w.band(formatMoney(part.from), part.to === null ? null : formatMoney(part.to), `${part.rate}%`), part.tax)}</Fragment>
            ))}
        {data.form === 'PD' && row(w.tax, data.tax, 'sub')}
        {data.instalments.map((item) => (
          <Fragment key={item.id}>{row(w.instalment(item.quarter), -item.amount)}</Fragment>
        ))}
        {data.restPayment && row(w.rest, -data.restPayment.amount)}
        {row(data.left < 0 ? w.overpaid : w.left, Math.abs(data.left), 'total')}
      </div>
    </Card>
  );
}

const moneyText = (value: number | null) => (value === null ? '' : String(value));

/** What the accountant adds: the carwash switch, adjustments and losses from TREFIN years. */
function Inputs({ data, canEdit }: { data: Declaration; canEdit: boolean }) {
  const t = useT();
  const setUp = useSetUp();
  const w = t.declaration.inputs;
  const queryClient = useQueryClient();
  const locked = data.status === 'filed' || !canEdit;
  const representation = data.adjustments.find((line) => line.key === 'representation')!;
  const donations = data.adjustments.find((line) => line.key === 'donations')!;
  const [includeCarwash, setIncludeCarwash] = useState(data.inputs.includeCarwash);
  const [rep, setRep] = useState(moneyText(data.inputs.representation));
  const [don, setDon] = useState(moneyText(data.inputs.donations));
  const [fines, setFines] = useState(data.inputs.fines ? String(data.inputs.fines) : '');
  const [other, setOther] = useState(data.inputs.other.map((line) => ({ label: line.label, amount: String(line.amount) })));
  const [losses, setLosses] = useState(data.inputs.earlierLosses.map((loss) => ({ year: String(loss.year), amount: String(loss.amount) })));
  const toInputs = (): DeclarationInputs => ({
    includeCarwash,
    representation: rep.trim() === '' ? null : Number(rep),
    donations: don.trim() === '' ? null : Number(don),
    fines: Number(fines) || 0,
    other: other.filter((line) => line.label.trim() !== '' && line.amount.trim() !== '').map((line) => ({ label: line.label.trim(), amount: Number(line.amount) })),
    earlierLosses: losses.filter((loss) => loss.year !== '' && Number(loss.amount) > 0).map((loss) => ({ year: Number(loss.year), amount: Number(loss.amount) })),
  });
  const changed = JSON.stringify(toInputs()) !== JSON.stringify(data.inputs);
  const save = useMutation({
    mutationFn: () => declarationApi.setInputs(data.year, toInputs()),
    onSuccess: (next) => queryClient.setQueryData(['books', 'declaration', data.year], next),
  });
  const lossYears = Array.from({ length: 6 }, (_, index) => data.year - 6 + index);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (changed) save.mutate();
  }

  return (
    <Card title={w.title} description={locked && data.status === 'filed' ? w.locked : w.description}>
      <form className="settings-form declaration__inputs" onSubmit={handleSubmit}>
        <fieldset disabled={locked} className="declaration__fieldset">
          {/* A business without a carwash has nothing to count here. */}
          {data.legalForm === 'company' && setUp.carwash && (
            <div className="field">
              <label className="toggle">
                <input type="checkbox" name="includeCarwash" checked={includeCarwash} onChange={(event) => setIncludeCarwash(event.target.checked)} aria-describedby="declaration-carwash-hint" />
                {w.carwash}
              </label>
              <p id="declaration-carwash-hint" className="field__hint">
                {w.carwashHint(formatMoney(data.carwash.takings), formatMoney(data.carwash.wages), formatMoney(data.carwash.bills))}
              </p>
            </div>
          )}
          <Field label={w.representation} hint={w.representationHint(formatMoney(representation.spent ?? 0), formatMoney(representation.allowed ?? 0))}>
            <input name="representation" autoComplete="off" type="number" inputMode="decimal" min={0} step={0.01} placeholder={formatMoney(representation.suggested ?? 0)} value={rep} onChange={(event) => setRep(event.target.value)} />
          </Field>
          <Field label={w.donations} hint={w.donationsHint(formatMoney(donations.spent ?? 0), formatMoney(donations.allowed ?? 0))}>
            <input name="donations" autoComplete="off" type="number" inputMode="decimal" min={0} step={0.01} placeholder={formatMoney(donations.suggested ?? 0)} value={don} onChange={(event) => setDon(event.target.value)} />
          </Field>
          <Field label={w.fines} hint={w.finesHint}>
            <input name="fines" autoComplete="off" type="number" inputMode="decimal" min={0} step={0.01} placeholder={formatMoney(0)} value={fines} onChange={(event) => setFines(event.target.value)} />
          </Field>
          <div className="field" role="group" aria-labelledby="declaration-other">
            <span id="declaration-other" className="field__label">
              {w.other}
            </span>
            <p className="field__hint">{w.otherHint}</p>
            {other.map((line, index) => (
              <div key={index} className="declaration__pair">
                <input aria-label={w.otherLabel} name={`other-label-${index}`} autoComplete="off" maxLength={120} placeholder={`${w.otherLabel}…`} value={line.label} onChange={(event) => setOther(other.map((item, at) => (at === index ? { ...item, label: event.target.value } : item)))} />
                <input aria-label={w.otherAmount} name={`other-amount-${index}`} autoComplete="off" type="number" inputMode="decimal" step={0.01} className="declaration__money" value={line.amount} onChange={(event) => setOther(other.map((item, at) => (at === index ? { ...item, amount: event.target.value } : item)))} />
                <Button size="sm" variant="ghost" icon={X} aria-label={w.remove(line.label || w.otherLabel)} onClick={() => setOther(other.filter((_, at) => at !== index))} />
              </div>
            ))}
            {!locked && other.length < 20 && (
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setOther([...other, { label: '', amount: '' }])}>
                {w.addOther}
              </Button>
            )}
          </div>
          <div className="field" role="group" aria-labelledby="declaration-losses">
            <span id="declaration-losses" className="field__label">
              {w.losses}
            </span>
            <p className="field__hint">{w.lossesHint(data.year - 6, data.year - 1)}</p>
            {losses.map((loss, index) => (
              <div key={index} className="declaration__pair">
                <select aria-label={w.lossYear} name={`loss-year-${index}`} value={loss.year} onChange={(event) => setLosses(losses.map((item, at) => (at === index ? { ...item, year: event.target.value } : item)))}>
                  <option value="">{w.lossYear}</option>
                  {lossYears.map((value) => (
                    <option key={value} value={value} disabled={losses.some((item, at) => at !== index && item.year === String(value))}>
                      {value}
                    </option>
                  ))}
                </select>
                <input aria-label={w.lossAmount} name={`loss-amount-${index}`} autoComplete="off" type="number" inputMode="decimal" min={0.01} step={0.01} className="declaration__money" value={loss.amount} onChange={(event) => setLosses(losses.map((item, at) => (at === index ? { ...item, amount: event.target.value } : item)))} />
                <Button size="sm" variant="ghost" icon={X} aria-label={w.remove(loss.year || w.lossYear)} onClick={() => setLosses(losses.filter((_, at) => at !== index))} />
              </div>
            ))}
            {!locked && losses.length < 6 && (
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setLosses([...losses, { year: '', amount: '' }])}>
                {w.addLoss}
              </Button>
            )}
          </div>
        </fieldset>
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        {!locked && (
          <div className="form-actions">
            <Button type="submit" variant={changed ? 'primary' : 'secondary'} disabled={!changed || save.isPending} loading={save.isPending}>
              {w.save}
            </Button>
            {(save.isPending || (save.isSuccess && !changed)) && (
              <span className="field__hint" role="status">
                <SwapText>{save.isPending ? t.common.saving : w.saved}</SwapText>
              </span>
            )}
          </div>
        )}
      </form>
    </Card>
  );
}

/** Paying the rest, marking as filed and reopening. */
function Filing({ data, canEdit }: { data: Declaration; canEdit: boolean }) {
  const t = useT();
  const w = t.declaration.file;
  const p = t.declaration.pay;
  const queryClient = useQueryClient();
  const [day, setDay] = useState(todayIso());
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useFocusFirst(confirming);
  const [paying, setPaying] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const undoRef = useFocusFirst(undoing);
  const refresh = (next: Declaration) => {
    queryClient.setQueryData(['books', 'declaration', data.year], next);
    queryClient.invalidateQueries({ queryKey: ['attention'] });
  };
  const file = useMutation({
    mutationFn: () => declarationApi.file(data.year, day),
    onSuccess: (next) => {
      refresh(next);
      setConfirming(false);
    },
  });
  const undo = useMutation({
    mutationFn: async () => {
      await statementsApi.undo(data.restPayment!.id);
      return declarationApi.get(data.year);
    },
    onSuccess: (next) => {
      refresh(next);
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['money'] });
      setUndoing(false);
    },
  });
  const over = data.status !== 'not_over';
  const gap = data.closedTax !== null && Math.round(data.closedTax * 100) !== Math.round(data.tax * 100);

  return (
    <Card className="declaration__filing" title={w.title} description={w.description}>
      {gap && (
        <p className="notice notice--warn" role="status">
          {w.closedGap(formatMoney(data.closedTax ?? 0), formatMoney(data.tax))}
        </p>
      )}
      {data.changedSinceFiled && (
        <p className="notice notice--warn" role="status">
          {w.changed(formatMoney(data.tax), formatMoney(data.liveTax))}
        </p>
      )}
      {data.restPayment ? (
        <div className="declaration__paid">
          <p>
            {p.paidLine(formatMoney(data.restPayment.amount), formatBookDay(data.restPayment.paidOn), placeInSentence(t, data.restPayment.place))}
            {data.restPayment.by && ` · ${data.restPayment.by}`}
          </p>
          <div className="year-quarter__actions">
            {data.restPayment.entryId && (
              <Link to={`/books/journal?entry=${data.restPayment.entryId}&period=custom&from=${data.restPayment.paidOn}&to=${data.restPayment.paidOn}`}>{t.year.tm.openEntry}</Link>
            )}
            {canEdit &&
              (undoing ? (
                <span className="year-quarter__confirm" ref={undoRef}>
                  <Button size="sm" variant="danger" loading={undo.isPending} onClick={() => undo.mutate()}>
                    {p.takeBackConfirm}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setUndoing(false)}>
                    {t.common.cancel}
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="danger-text" onClick={() => setUndoing(true)}>
                  {p.takeBack}
                </Button>
              ))}
          </div>
          {undo.isError && (
            <p className="form-error" role="alert">
              {errorMessage(undo.error)}
            </p>
          )}
        </div>
      ) : (
        over &&
        data.left > 0 && (
          <div className="declaration__pay">
            <p className="year-close__why">{p.payBy(formatBookDay(data.due))}</p>
            {canEdit && <Button onClick={() => setPaying(true)}>{p.button}</Button>}
          </div>
        )
      )}
      {data.filed ? (
        <div className="declaration__filed">
          <p>{w.filedLine(formatBookDay(data.filed.on), data.filed.by)}</p>
          {canEdit && (
            <Button size="sm" onClick={() => setReopening(true)}>
              {w.reopen}
            </Button>
          )}
        </div>
      ) : !over ? (
        <p className="year-close__why">{w.notOver(data.year)}</p>
      ) : (
        canEdit && (
          <div className="declaration__file">
            <Field label={w.day}>
              <DateField value={day} min={`${data.year + 1}-01-01`} max={todayIso()} onChange={setDay} />
            </Field>
            {confirming ? (
              <div className="year-close__confirm" role="group" aria-label={w.confirm(data.form, data.year)}>
                <p>{w.confirmText}</p>
                <span ref={confirmRef}>
                  <Button variant="primary" loading={file.isPending} onClick={() => file.mutate()}>
                    {w.confirm(data.form, data.year)}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    {t.common.cancel}
                  </Button>
                </span>
              </div>
            ) : (
              <Button variant="primary" disabled={day === ''} onClick={() => setConfirming(true)}>
                {w.button}
              </Button>
            )}
            {file.isError && (
              <p className="form-error" role="alert">
                {errorMessage(file.error)}
              </p>
            )}
          </div>
        )
      )}
      <Sheet open={paying} onClose={() => setPaying(false)} title={p.title} description={p.description}>
        {paying && (
          <PayRestForm
            data={data}
            onDone={(next) => {
              if (next) refresh(next);
              setPaying(false);
            }}
          />
        )}
      </Sheet>
      <Sheet open={reopening} onClose={() => setReopening(false)} title={w.reopenTitle(data.form, data.year)} description={w.reopenHint}>
        {reopening && (
          <ReopenForm
            year={data.year}
            onDone={(next) => {
              if (next) refresh(next);
              setReopening(false);
            }}
          />
        )}
      </Sheet>
    </Card>
  );
}

function PayRestForm({ data, onDone }: { data: Declaration; onDone: (next: Declaration | null) => void }) {
  const t = useT();
  const w = t.declaration.pay;
  const queryClient = useQueryClient();
  const places = useQuery({ queryKey: ['money', 'places'], queryFn: moneyApi.places });
  const inBooks = (places.data ?? []).filter((place) => place.inBooks && !place.archived);
  const [amount, setAmount] = useState(data.left > 0 ? String(data.left) : '');
  const [day, setDay] = useState(todayIso());
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const chosen = placeId ?? inBooks.find((place) => place.kind === 'bank' && place.isDefault)?.id ?? null;
  const place = inBooks.find((candidate) => candidate.id === chosen) ?? null;
  const save = useMutation({
    mutationFn: () => declarationApi.payRest(data.year, { amount: Number(amount), day, placeId: chosen!, note: note.trim() || null }),
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['money'] });
      onDone(next);
    },
  });
  const value = Number(amount);
  const ready = value > 0 && day !== '' && chosen !== null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (ready) save.mutate();
  }

  if (places.isPending) return <Loading />;
  if (places.isError) return <ErrorNotice error={places.error} onRetry={() => places.refetch()} />;
  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={w.amount} hint={w.amountHint(formatMoney(data.left))}>
        <input name="amount" autoComplete="off" type="number" inputMode="decimal" min={0.01} step={0.01} required value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <div className="field-row">
        <Field label={w.day}>
          <DateField value={day} min={`${data.year + 1}-01-01`} max={todayIso()} onChange={setDay} />
        </Field>
        <Field label={w.place}>
          <PlaceSelect places={inBooks} value={chosen} onChange={setPlaceId} required />
        </Field>
      </div>
      <Field label={w.note} hint={w.noteHint}>
        <input name="note" maxLength={300} autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {ready && place && <p className="statements-sentence">{w.sentence(formatMoney(value), placeInSentence(t, place), data.year)}</p>}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!ready || save.isPending} loading={save.isPending}>
          {w.save}
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function ReopenForm({ year, onDone }: { year: number; onDone: (next: Declaration | null) => void }) {
  const t = useT();
  const w = t.declaration.file;
  const [reason, setReason] = useState('');
  const reopen = useMutation({ mutationFn: () => declarationApi.reopen(year, reason), onSuccess: (next) => onDone(next) });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    reopen.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={w.reason} hint={w.reasonHint}>
        <textarea name="reason" required minLength={3} maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {reopen.isError && (
        <p className="form-error" role="alert">
          {errorMessage(reopen.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="danger" disabled={reason.trim().length < 3 || reopen.isPending} loading={reopen.isPending}>
          {w.reopenButton}
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
