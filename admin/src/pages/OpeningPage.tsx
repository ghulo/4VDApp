import { Check, Plus, Scales } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { canWriteEntries } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { formatBookDay } from '../components/BooksParts';
import { ErrorNotice, Loading } from '../components/Feedback';
import { placeName } from '../components/MoneyParts';
import { Badge, Button, ButtonLink, DataTable, EmptyState, Field, PageHeader, Sheet, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { booksApi, moneyApi } from '../services/api';
import { ACCOUNT_CLASSES, type OpeningBalances, type OpeningLine, type OpeningLineKind, TYPED_OPENING_SOURCES } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatHeadlineMoney, formatMoney } from '../utils/format';

type Catalogue = ReturnType<typeof useT>;
type TypedSource = (typeof TYPED_OPENING_SOURCES)[number];

const QUERY_KEY = ['books', 'opening'];
const GROUP_ORDER: Array<OpeningLineKind | 'capital'> = ['place', 'stock', 'supplier', 'customer', 'account', 'capital'];
/** Accounts a balance can be added on: what the shop has, owes, and its capital. */
const CARRIED = new Set(['asset', 'liability', 'equity']);

/** The capital line closes the table: worked out, never typed or confirmed. */
type Row = OpeningLine | { id: 'capital'; kind: 'capital'; amount: number; account: OpeningBalances['capital']['account'] };
const isCapital = (row: Row): row is Extract<Row, { kind: 'capital' }> => row.kind === 'capital';

function lineName(t: Catalogue, line: OpeningLine): string {
  if (line.place) return placeName(t, line.place);
  if (line.kind === 'stock') return t.opening.stock;
  if (line.party) return line.party.name;
  return `${line.account.number} ${line.account.name}`;
}

/**
 * What the shop has and owes on the books' first day, line by line: where each
 * figure came from, what TREFIN said, and who confirmed it. Posted only once
 * every line is confirmed; the difference goes to the owners' capital.
 */
export function OpeningPage() {
  const t = useT();
  const o = t.opening;
  const { role } = useCurrentUser();
  const canWrite = canWriteEntries(role);
  const queryClient = useQueryClient();
  const opening = useQuery({ queryKey: QUERY_KEY, queryFn: booksApi.opening });
  const [adding, setAdding] = useState(false);
  const [posting, setPosting] = useState(false);
  const [takingBack, setTakingBack] = useState(false);

  const settle = (data: OpeningBalances) => {
    queryClient.setQueryData(QUERY_KEY, data);
    void queryClient.invalidateQueries({ queryKey: ['books'], predicate: (query) => query.queryKey[1] !== 'opening' });
    void queryClient.invalidateQueries({ queryKey: ['money'] });
  };
  const confirm = useMutation({ mutationFn: ({ ids, confirmed }: { ids: number[]; confirmed: boolean }) => booksApi.confirmOpening(ids, confirmed), onSuccess: settle });
  const remove = useMutation({ mutationFn: booksApi.removeOpeningLine, onSuccess: settle });

  const data = opening.data;
  const posted = data?.posted ?? null;
  const locked = !canWrite || posted !== null;
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const order = (kind: Row['kind']) => GROUP_ORDER.indexOf(kind);
    // Suppliers and customers biggest first: those are the ones worth checking against their statements.
    const partner = (line: OpeningLine) => (line.kind === 'supplier' || line.kind === 'customer' ? -Math.abs(line.amount) : 0);
    const lines = [...data.lines].sort((a, b) => order(a.kind) - order(b.kind) || partner(a) - partner(b) || a.id - b.id);
    return [...lines, { id: 'capital', kind: 'capital', amount: data.capital.amount, account: data.capital.account }];
  }, [data]);
  const toConfirm = (kind: OpeningLineKind) => data?.lines.filter((line) => line.kind === kind && !line.confirmed).map((line) => line.id) ?? [];
  const day = data?.startDay ? formatBookDay(data.startDay) : null;
  const open = data ? data.lines.length - data.confirmed : 0;

  const groupHeading = (kind: Row['kind']) => {
    const waiting = kind === 'capital' ? [] : toConfirm(kind);
    return (
      <span className="opening-group">
        <span>{o.groups[kind]}</span>
        {!locked && waiting.length > 1 && (
          <Button size="sm" variant="secondary" icon={Check} loading={confirm.isPending} onClick={() => confirm.mutate({ ids: waiting, confirmed: true })}>
            {o.confirmAll(waiting.length)}
          </Button>
        )}
      </span>
    );
  };

  return (
    <>
      <PageHeader
        wide
        title={o.title}
        meta={posted && <Badge tone="ok">{o.posted}</Badge>}
        description={posted && day ? o.postedDescription(day) : day ? o.description(day) : o.noStartDescription}
        actions={
          canWrite &&
          data &&
          (posted ? (
            <Button variant="secondary" onClick={() => setTakingBack(true)}>
              {o.takeBack}
            </Button>
          ) : (
            <Button variant="primary" disabled={data.blockers.length > 0} aria-describedby={data.blockers.length > 0 && day ? 'opening-blockers' : undefined} onClick={() => setPosting(true)}>
              {o.post}
            </Button>
          ))
        }
      />
      {opening.isPending && <Loading />}
      {opening.isError && <ErrorNotice error={opening.error} onRetry={() => opening.refetch()} />}
      {data && (
        <>
          {!data.startDay && (
            <div className="notice notice--warn" role="status">
              <span>{o.noStart}</span>
              {canWrite && (
                <ButtonLink size="sm" to="/settings/books">
                  {o.noStartAction}
                </ButtonLink>
              )}
            </div>
          )}
          {posted && (
            <div className="notice" role="status">
              <span>{o.postedOn(formatDateTime(posted.at), posted.by)}</span>
              <ButtonLink size="sm" variant="secondary" to={`/books/journal?entry=${posted.entryId}`}>
                {o.openEntry}
              </ButtonLink>
            </div>
          )}
          {!posted && <TrefinNotice t={t} trefin={data.trefin} />}

          <StatGrid compact>
            <StatTile label={o.tiles.has} value={formatHeadlineMoney(data.debits)} />
            <StatTile label={o.tiles.owes} value={formatHeadlineMoney(data.credits)} />
            <StatTile label={o.tiles.capital} value={formatHeadlineMoney(data.capital.amount)} hint={o.tiles.capitalHint} />
            <StatTile
              label={o.tiles.confirmed}
              value={o.tiles.confirmedValue(data.confirmed, data.lines.length)}
              tone={!posted && open > 0 ? 'warn' : 'default'}
            />
          </StatGrid>

          {(confirm.isError || remove.isError) && (
            <p className="form-error" role="alert">
              {errorMessage(confirm.error ?? remove.error)}
            </p>
          )}

          <DataTable<Row>
            caption={o.caption}
            rows={rows}
            rowKey={(row) => row.id}
            density="compact"
            group={(row) => ({ key: row.kind, heading: groupHeading(row.kind) })}
            rowClassName={(row) => (isCapital(row) ? 'opening-capital' : undefined)}
            toolbar={
              !locked && (
                <div className="toolbar">
                  <div className="toolbar__end">
                    <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
                      {o.add}
                    </Button>
                  </div>
                </div>
              )
            }
            empty={<EmptyState icon={Scales} title={o.title}>{o.noStart}</EmptyState>}
            columns={[
              { header: o.columns.what, title: true, cell: (row) => <WhatCell t={t} row={row} /> },
              {
                header: o.columns.from,
                cell: (row) => (isCapital(row) ? null : <SourceCell t={t} line={row} locked={locked} onSaved={settle} />),
              },
              {
                header: o.columns.trefin,
                align: 'end',
                cell: (row) => (isCapital(row) || row.trefinAmount === null ? '–' : formatMoney(row.trefinAmount)),
              },
              {
                header: o.columns.amount,
                align: 'end',
                cell: (row) =>
                  isCapital(row) ? <strong>{formatMoney(row.amount)}</strong> : <AmountCell key={row.amount} t={t} line={row} locked={locked} onSaved={settle} />,
              },
              {
                header: o.columns.check,
                cell: (row) =>
                  isCapital(row) ? null : (
                    <span className="opening-check">
                      <ConfirmButton t={t} line={row} locked={locked} pending={confirm.isPending} onToggle={(confirmed) => confirm.mutate({ ids: [row.id], confirmed })} />
                      {!locked && row.kind === 'account' && (
                        <Button size="sm" variant="danger-text" aria-label={o.removeLabel(lineName(t, row))} loading={remove.isPending && remove.variables === row.id} onClick={() => remove.mutate(row.id)}>
                          {o.remove}
                        </Button>
                      )}
                    </span>
                  ),
              },
            ]}
            footer={
              !posted &&
              day && (
                <p className="opening-sentence" id="opening-blockers">
                  {o.sentence(day, formatMoney(data.debits), formatMoney(data.credits), formatMoney(data.capital.amount))}{' '}
                  {data.blockers.includes('unconfirmed') && <strong>{o.blockers.unconfirmed(open)}</strong>}
                  {!data.blockers.includes('unconfirmed') && data.blockers.includes('empty') && <strong>{o.blockers.empty}</strong>}
                </p>
              )
            }
          />

          <Sheet open={adding} onClose={() => setAdding(false)} title={o.add} description={o.addDescription}>
            <AddBalanceForm
              t={t}
              taken={new Set(data.lines.map((line) => line.account.id).concat(data.capital.account.id))}
              onSaved={(next) => {
                settle(next);
                setAdding(false);
              }}
            />
          </Sheet>
          <Sheet open={posting} onClose={() => setPosting(false)} title={o.post} description={o.postDescription}>
            <PostForm
              t={t}
              data={data}
              onDone={(next) => {
                settle(next);
                setPosting(false);
              }}
            />
          </Sheet>
          <Sheet open={takingBack} onClose={() => setTakingBack(false)} title={o.takeBackTitle} description={o.takeBackDescription}>
            <TakeBackForm
              t={t}
              onDone={(next) => {
                settle(next);
                setTakingBack(false);
              }}
            />
          </Sheet>
        </>
      )}
    </>
  );
}

function TrefinNotice({ t, trefin }: { t: Catalogue; trefin: OpeningBalances['trefin'] }) {
  const o = t.opening;
  if (!trefin) {
    return (
      <div className="notice" role="status">
        <span>{o.noTrefin}</span>
      </div>
    );
  }
  return (
    <div className="notice" role="status">
      <div className="opening-trefin">
        <span>
          {o.trefinLoaded(formatDate(trefin.at))} {trefin.off !== 0 && o.trefinOff(formatMoney(Math.abs(trefin.off)))}
        </span>
        {trefin.skipped.length > 0 && (
          <>
            <span>{o.skipped(trefin.skipped.length)}</span>
            <ul className="opening-skipped">
              {trefin.skipped.map((item) => (
                <li key={item.what}>
                  {item.what}: {formatMoney(item.amount)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function WhatCell({ t, row }: { t: Catalogue; row: Row }) {
  const o = t.opening;
  if (isCapital(row)) {
    return (
      <span className="opening-what">
        <span>
          <span className="books-number">{row.account.number}</span> {row.account.name}
        </span>
        <span className="opening-what__hint">{o.capitalLine}</span>
      </span>
    );
  }
  let name: ReactNode = lineName(t, row);
  let hint: ReactNode = null;
  if (row.place) {
    name = <Link to={`/money/${row.place.id}`}>{lineName(t, row)}</Link>;
    hint = o.placeHint[row.place.kind];
  } else if (row.kind === 'stock') {
    hint = (
      <>
        {o.stockFacts(row.facts.products ?? 0)} {row.facts.noCost ? <Link to="/products">{o.stockNoCost(row.facts.noCost)}</Link> : o.stockHint}
      </>
    );
  } else if (row.kind === 'supplier' && row.party) {
    name = <Link to={`/suppliers/${row.party.id}`}>{row.party.name}</Link>;
    hint = row.facts.documents ? o.bills(row.facts.documents) : o.nothingBrought;
  } else if (row.kind === 'customer' && row.party) {
    name = <Link to={`/customers/${row.party.id}`}>{row.party.name}</Link>;
    hint = row.facts.documents ? o.charges : o.nothingBrought;
  } else if (row.kind === 'account') {
    name = (
      <Link to={`/books/accounts/${row.account.id}`}>
        <span className="books-number">{row.account.number}</span> {row.account.name}
      </Link>
    );
    hint = o.explain[row.account.number] ?? row.note;
  }
  const differs = row.trefinAmount !== null && Math.round(row.trefinAmount * 100) !== Math.round(row.amount * 100);
  return (
    <span className="opening-what">
      <span>{name}</span>
      {hint && <span className="opening-what__hint">{hint}</span>}
      {differs && <span className="opening-what__hint opening-what__differs">{o.differs(formatMoney(Math.abs(row.amount - row.trefinAmount!)))}</span>}
    </span>
  );
}

function SourceCell({ t, line, locked, onSaved }: { t: Catalogue; line: OpeningLine; locked: boolean; onSaved: (data: OpeningBalances) => void }) {
  const o = t.opening;
  const save = useMutation({ mutationFn: (source: TypedSource) => booksApi.updateOpeningLine(line.id, { source }), onSuccess: onSaved });
  const typed = (TYPED_OPENING_SOURCES as readonly string[]).includes(line.source);
  if (locked || !line.editable || !typed) return <Badge tone="neutral">{o.sources[line.source]}</Badge>;
  return (
    <select
      className="opening-source"
      aria-label={o.sourceLabel(lineName(t, line))}
      value={line.source}
      disabled={save.isPending}
      onChange={(event) => save.mutate(event.target.value as TypedSource)}
    >
      {TYPED_OPENING_SOURCES.map((source) => (
        <option key={source} value={source}>
          {o.sources[source]}
        </option>
      ))}
    </select>
  );
}

const parseAmount = (text: string): number | null => {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
};

/** A typed figure saves when the field is left or Enter is pressed; a worked-out one is shown as it is. Keyed by the figure, so a saved one starts fresh. */
function AmountCell({ t, line, locked, onSaved }: { t: Catalogue; line: OpeningLine; locked: boolean; onSaved: (data: OpeningBalances) => void }) {
  const o = t.opening;
  const [text, setText] = useState(line.amount.toFixed(2));
  const errorId = useId();
  const save = useMutation({ mutationFn: (amount: number) => booksApi.updateOpeningLine(line.id, { amount }), onSuccess: onSaved });
  if (locked || !line.editable) return formatMoney(line.amount);
  const parsed = parseAmount(text);
  const commit = () => {
    if (parsed === null || Math.round(parsed * 100) === Math.round(line.amount * 100)) return;
    save.mutate(parsed);
  };
  return (
    <span className="opening-amount">
      <input
        className="opening-amount__input"
        inputMode="decimal"
        name={`opening-${line.id}`}
        autoComplete="off"
        spellCheck={false}
        aria-label={o.amountLabel(lineName(t, line))}
        aria-invalid={parsed === null}
        aria-describedby={parsed === null || save.isError ? errorId : undefined}
        value={text}
        disabled={save.isPending}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setText(line.amount.toFixed(2));
        }}
      />
      {parsed === null && (
        <span className="field__error" role="alert" id={errorId}>
          {o.badAmount}
        </span>
      )}
      {save.isError && parsed !== null && (
        <span className="field__error" role="alert" id={errorId}>
          {errorMessage(save.error)}
        </span>
      )}
    </span>
  );
}

function ConfirmButton({ t, line, locked, pending, onToggle }: { t: Catalogue; line: OpeningLine; locked: boolean; pending: boolean; onToggle: (confirmed: boolean) => void }) {
  const o = t.opening;
  const name = lineName(t, line);
  const who = line.confirmed && line.confirmedBy && line.confirmedAt ? o.confirmedBy(line.confirmedBy, formatDateTime(line.confirmedAt)) : undefined;
  if (locked) return line.confirmed ? <Badge tone="ok">{o.confirmed}</Badge> : <Badge tone="warn">{o.columns.check}</Badge>;
  return line.confirmed ? (
    <Button size="sm" variant="ghost" icon={Check} title={who} disabled={pending} onClick={() => onToggle(false)}>
      {o.confirmed}
      <span className="visually-hidden"> {name}</span>
    </Button>
  ) : (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => onToggle(true)}>
      {o.confirm}
      <span className="visually-hidden"> {name}</span>
    </Button>
  );
}

function AddBalanceForm({ t, taken, onSaved }: { t: Catalogue; taken: Set<number>; onSaved: (data: OpeningBalances) => void }) {
  const o = t.opening;
  const accounts = useQuery({ queryKey: ['books', 'accounts'], queryFn: booksApi.accounts });
  const places = useQuery({ queryKey: ['money', 'places'], queryFn: moneyApi.places });
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const save = useMutation({ mutationFn: booksApi.addOpeningLine, onSuccess: onSaved });
  const placeAccounts = new Set((places.data ?? []).map((place) => place.account?.id));
  const choices = ACCOUNT_CLASSES.filter((accountClass) => CARRIED.has(accountClass)).map((accountClass) => ({
    accountClass,
    accounts: (accounts.data ?? []).filter(
      (account) => account.accountClass === accountClass && !account.archived && !taken.has(account.id) && !placeAccounts.has(account.id) && !account.links.includes('stock'),
    ),
  }));
  const parsed = parseAmount(amount);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!accountId || parsed === null) return;
    save.mutate({ accountId: Number(accountId), amount: parsed, note: note.trim() || null });
  };
  return (
    <form className="settings-form" onSubmit={submit}>
      <Field label={o.account} hint={o.accountHint}>
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>
          <option value="">{o.pickAccount}</option>
          {choices.map((group) => (
            <optgroup key={group.accountClass} label={t.books.classes[group.accountClass]}>
              {group.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.number} {account.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      {accountId && o.explain[(accounts.data ?? []).find((account) => String(account.id) === accountId)?.number ?? ''] && (
        <p className="field-hint">{o.explain[(accounts.data ?? []).find((account) => String(account.id) === accountId)!.number]}</p>
      )}
      <Field label={o.amount} hint={o.amountHint} error={amount !== '' && parsed === null ? o.badAmount : undefined} narrow>
        <input name="amount" inputMode="decimal" autoComplete="off" spellCheck={false} value={amount} onChange={(event) => setAmount(event.target.value)} required />
      </Field>
      <Field label={o.note}>
        <input name="note" autoComplete="off" value={note} maxLength={300} placeholder={o.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!accountId || parsed === null} loading={save.isPending}>
          {o.add}
        </Button>
      </div>
    </form>
  );
}

function PostForm({ t, data, onDone }: { t: Catalogue; data: OpeningBalances; onDone: (data: OpeningBalances) => void }) {
  const o = t.opening;
  const post = useMutation({ mutationFn: booksApi.postOpening, onSuccess: onDone });
  return (
    <div className="settings-form">
      <p>{o.sentence(formatBookDay(data.startDay!), formatMoney(data.debits), formatMoney(data.credits), formatMoney(data.capital.amount))}</p>
      {post.isError && (
        <p className="form-error" role="alert">
          {errorMessage(post.error)}
        </p>
      )}
      <div className="form-actions">
        <Button variant="primary" loading={post.isPending} onClick={() => post.mutate()}>
          {o.post}
        </Button>
      </div>
    </div>
  );
}

function TakeBackForm({ t, onDone }: { t: Catalogue; onDone: (data: OpeningBalances) => void }) {
  const o = t.opening;
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const takeBack = useMutation({ mutationFn: booksApi.takeBackOpening, onSuccess: onDone });
  const missing = reason.trim().length < 3;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!missing) takeBack.mutate(reason.trim());
  };
  return (
    <form className="settings-form" onSubmit={submit}>
      <Field label={o.reason} error={tried && missing ? o.reasonMissing : undefined}>
        <input name="reason" autoComplete="off" value={reason} maxLength={500} placeholder={o.reasonPlaceholder} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {takeBack.isError && (
        <p className="form-error" role="alert">
          {errorMessage(takeBack.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="danger" loading={takeBack.isPending}>
          {o.takeBack}
        </Button>
      </div>
    </form>
  );
}
