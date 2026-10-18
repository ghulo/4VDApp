import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useMemo, useState } from 'react';
import type { Catalogue } from '../i18n/en';
import { useT } from '../i18n/useT';
import { moneyApi } from '../services/api';
import type { MoneyPlace, MoneyPlaceKind } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { todayIso } from '../utils/bills';
import { Button, DateField, Field } from './ui';

/** Every place money is kept, shared by the pages and forms that pick one. */
export function usePlaces() {
  return useQuery({ queryKey: ['money', 'places'], queryFn: moneyApi.places, staleTime: 30_000 });
}

/** What everything that shows money in a place needs to fetch again after money moves. */
export const MONEY_KEYS = ['money', 'bills', 'customers', 'cash', 'activity', 'books', 'full-report', 'reports', 'orders'];

export function useMoneyRefresh() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of MONEY_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

type PlaceLike = Pick<MoneyPlace, 'kind' | 'name'> & { carwashId?: number | null };

/** A place's name on its own: "Shop till", "Lavazhi Qendër till", "Safe", "Raiffeisen". */
export function placeName(t: Catalogue, place: PlaceLike): string {
  if (place.kind === 'till') return place.carwashId || (place.carwashId === undefined && place.name) ? t.money.carwashTill(place.name ?? '') : t.money.shopTill;
  return place.name ?? t.money.kinds[place.kind];
}

/** A place's name inside a sentence: "the shop till", "the safe", "Raiffeisen". */
export function placeInSentence(t: Catalogue, place: PlaceLike | null): string {
  if (place === null) return t.money.theOwner;
  if (place.kind === 'till') return place.carwashId || (place.carwashId === undefined && place.name) ? t.money.sentence.carwashTill(place.name ?? '') : t.money.sentence.shopTill;
  return place.name ?? t.money.sentence[place.kind];
}

const KIND_ORDER: MoneyPlaceKind[] = ['till', 'safe', 'bank'];

/** A choice of place, grouped as tills, cash and bank accounts; closed places left out. */
export function PlaceSelect({
  places,
  value,
  onChange,
  kinds = KIND_ORDER,
  owner,
  required,
  id,
  describedBy,
}: {
  places: MoneyPlace[];
  value: number | null;
  onChange: (id: number | null) => void;
  kinds?: MoneyPlaceKind[];
  /** Offer the owner too (money put in or taken out), as the empty value. */
  owner?: string;
  required?: boolean;
  id?: string;
  describedBy?: string;
}) {
  const t = useT();
  const open = places.filter((place) => !place.archived && kinds.includes(place.kind));
  return (
    <select
      id={id}
      required={required}
      aria-describedby={describedBy}
      value={value === null ? (owner ? 'owner' : '') : String(value)}
      onChange={(event) => onChange(event.target.value === 'owner' || event.target.value === '' ? null : Number(event.target.value))}
    >
      {!owner && value === null && (
        <option value="" disabled>
          {t.money.pickPlace}
        </option>
      )}
      {kinds.map((kind) => {
        const group = open.filter((place) => place.kind === kind);
        if (group.length === 0) return null;
        return (
          <optgroup key={kind} label={t.money.groups[kind]}>
            {group.map((place) => (
              <option key={place.id} value={place.id}>
                {placeName(t, place)}
              </option>
            ))}
          </optgroup>
        );
      })}
      {owner && <option value="owner">{owner}</option>}
    </select>
  );
}

/** The usual place for a kind: the shop's till, the main safe, the main bank account. */
export function usualPlace(places: MoneyPlace[] | undefined, kind: MoneyPlaceKind): number | null {
  const open = (places ?? []).filter((place) => !place.archived && place.kind === kind);
  const usual = kind === 'till' ? open.find((place) => place.carwashId === null) : open.find((place) => place.isDefault);
  return (usual ?? open[0])?.id ?? null;
}

/** One sentence for a move before it is saved: "€800.00 leaves the shop till and arrives at Raiffeisen." */
export function moveSentence(t: Catalogue, amount: number, from: PlaceLike | null, to: PlaceLike | null): string {
  const money = formatMoney(amount);
  if (from === null) return t.money.move.ownerIn(money, placeInSentence(t, to));
  if (to === null) return t.money.move.ownerOut(money, placeInSentence(t, from));
  return t.money.move.between(money, placeInSentence(t, from), placeInSentence(t, to));
}

const cents = (amount: number) => Math.round(amount * 100);

/** An amount spread over items, the oldest first, each up to what is left on it; unticked items get nothing. */
export function spread<T extends { key: string; left: number }>(items: T[], ticked: Set<string>, amount: number): Map<string, number> {
  const parts = new Map<string, number>();
  let rest = cents(amount);
  for (const item of items) {
    if (!ticked.has(item.key)) continue;
    const part = Math.max(0, Math.min(cents(item.left), rest));
    parts.set(item.key, part / 100);
    rest -= part;
  }
  return parts;
}

/** Open items to tick, each with the part of the amount it gets. */
export function SpreadList<T extends { key: string; left: number; label: string; detail: string }>({
  items,
  ticked,
  onToggle,
  parts,
  caption,
}: {
  items: T[];
  ticked: Set<string>;
  onToggle: (key: string) => void;
  parts: Map<string, number>;
  caption: string;
}) {
  const t = useT();
  return (
    <fieldset className="money-spread">
      <legend className="field__label">{caption}</legend>
      <ul className="money-spread__list">
        {items.map((item) => {
          const part = parts.get(item.key) ?? 0;
          return (
            <li key={item.key} className="money-spread__item">
              <label className="money-spread__label">
                <input type="checkbox" checked={ticked.has(item.key)} onChange={() => onToggle(item.key)} />
                <span className="money-spread__name">
                  {item.label}
                  <span className="table__secondary">{item.detail}</span>
                </span>
              </label>
              <span className="money-spread__left">{t.money.spreadLeft(formatMoney(item.left))}</span>
              <strong className="money-spread__part">
                <span className="visually-hidden">{t.money.spreadPart(formatMoney(part))}</span>
                <span aria-hidden="true">{part > 0 ? formatMoney(part) : '–'}</span>
              </strong>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** Money from one place to another, or put in or taken out by the owner. */
export function MoveForm({ places, from: initialFrom, to: initialTo, onDone }: { places: MoneyPlace[]; from?: number | null; to?: number | null; onDone: () => void }) {
  const t = useT();
  const refresh = useMoneyRefresh();
  const fromId = useId();
  const toId = useId();
  const sentenceId = useId();
  const [from, setFrom] = useState<number | null>(initialFrom !== undefined ? initialFrom : usualPlace(places, 'till'));
  const [to, setTo] = useState<number | null>(initialTo !== undefined ? initialTo : usualPlace(places, 'bank'));
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(todayIso());
  const [note, setNote] = useState('');
  const byId = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const save = useMutation({
    mutationFn: () => moneyApi.move({ day, amount: Number(amount), fromPlaceId: from, toPlaceId: to, note: note.trim() || null }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const value = Number(amount);
  const fromPlace = from === null ? null : (byId.get(from) ?? null);
  const toPlace = to === null ? null : (byId.get(to) ?? null);
  const problem = from === null && to === null ? t.money.move.needOne : from !== null && from === to ? t.money.move.samePlace : null;
  const valid = value > 0 && day !== '' && problem === null;
  const short = fromPlace && value > fromPlace.balance && fromPlace.balance >= 0 ? t.money.move.moreThanIn(formatMoney(fromPlace.balance)) : null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit} aria-describedby={sentenceId}>
      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor={fromId}>
            {t.money.move.from}
          </label>
          <PlaceSelect id={fromId} places={places} value={from} onChange={setFrom} owner={t.money.move.ownerPutIn} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={toId}>
            {t.money.move.to}
          </label>
          <PlaceSelect id={toId} places={places} value={to} onChange={setTo} owner={t.money.move.ownerTookOut} />
        </div>
      </div>
      <div className="field-row">
        <Field label={t.money.amountEuro} hint={short ?? undefined}>
          <input required type="number" inputMode="decimal" autoComplete="off" min={0.01} step={0.01} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label={t.money.day}>
          <DateField required max={todayIso()} value={day} onChange={setDay} />
        </Field>
      </div>
      <Field label={t.money.note}>
        <input maxLength={500} autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <p className="money-sentence" id={sentenceId} aria-live="polite">
        {problem ?? (value > 0 ? moveSentence(t, value, fromPlace, toPlace) : t.money.move.typeAmount)}
        {value > 0 && problem === null && day !== todayIso() && <span className="table__secondary">{t.money.move.on(formatDate(day))}</span>}
      </p>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
          {value > 0 ? t.money.move.save(formatMoney(value)) : t.money.move.title}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
