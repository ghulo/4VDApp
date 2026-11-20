import { PaperPlaneTilt } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { ErrorNotice } from './Feedback';
import { PlaceSelect, useMoneyRefresh } from './MoneyParts';
import { Button, DataTable, DateField, Field, Section, Sheet, useToast } from './ui';
import { useT } from '../i18n/useT';
import { returnsApi } from '../services/api';
import type { MoneyPlace, RefundToPay } from '../services/types';
import { todayIso } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';

/**
 * Money: refunds going back by bank transfer, each still owed to its
 * customer until someone sends it and marks it sent. Hidden when there are none.
 */
export function RefundsToPay({ places, writes }: { places: MoneyPlace[]; writes: boolean }) {
  const t = useT();
  const words = t.money.refunds;
  const owed = useQuery({ queryKey: ['money', 'refunds-to-pay'], queryFn: returnsApi.toPay });
  const [sending, setSending] = useState<RefundToPay | null>(null);

  if (owed.isPending || (owed.isSuccess && owed.data.length === 0)) return null;
  return (
    <Section title={words.title} description={words.hint}>
      {owed.isError ? (
        <ErrorNotice error={owed.error} onRetry={() => owed.refetch()} />
      ) : (
        <DataTable
          caption={words.title}
          rows={owed.data}
          rowKey={(row) => row.returnIds.join('-')}
          columns={[
            {
              header: t.refundMoney.customerName,
              title: true,
              cell: (row) => (
                <>
                  <span className="refund-pay__name">{words.line(row.customerName, formatMoney(row.amount))}</span>
                  <span className="refund-pay__iban">{row.iban ? formatIban(row.iban) : words.noIban}</span>
                </>
              ),
            },
            {
              header: words.receipt,
              cell: (row) => (row.receiptNumber ? words.from(row.receiptNumber, formatDate(row.day)) : words.fromDay(formatDate(row.day))),
            },
            { header: words.amount, align: 'end', cell: (row) => formatMoney(row.amount) },
            ...(writes
              ? [
                  {
                    header: <span className="visually-hidden">{words.markSent}</span>,
                    align: 'end' as const,
                    cell: (row: RefundToPay) => (
                      <Button size="sm" icon={PaperPlaneTilt} onClick={() => setSending(row)}>
                        {words.markSent}
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      <Sheet
        open={sending !== null}
        onClose={() => setSending(null)}
        title={sending ? words.sentTitle(sending.customerName, formatMoney(sending.amount)) : ''}
        description={words.sentHint}
      >
        {sending && <SentForm refund={sending} places={places} onDone={() => setSending(null)} />}
      </Sheet>
    </Section>
  );
}

function SentForm({ refund, places, onDone }: { refund: RefundToPay; places: MoneyPlace[]; onDone: () => void }) {
  const t = useT();
  const words = t.money.refunds;
  const id = useId();
  const toast = useToast();
  const refresh = useMoneyRefresh();
  const bank = places.find((place) => place.kind === 'bank' && place.isDefault && !place.archived);
  const [placeId, setPlaceId] = useState<number | null>(bank?.id ?? null);
  const [day, setDay] = useState(todayIso());
  const save = useMutation({
    mutationFn: () => returnsApi.markSent({ returnIds: refund.returnIds, placeId: placeId!, day }),
    onSuccess: () => {
      refresh();
      toast({ title: words.done(refund.customerName) });
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (placeId !== null && day) save.mutate();
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-from`}>
          {words.sentFrom}
        </label>
        <PlaceSelect id={`${id}-from`} places={places} value={placeId} onChange={setPlaceId} required />
      </div>
      <Field label={words.sentOn}>
        <DateField value={day} onChange={setDay} max={todayIso()} required aria-label={words.sentOn} />
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={placeId === null || !day}>
          {save.isPending ? words.saving : words.save}
        </Button>
      </div>
    </form>
  );
}

/** "XK051212012345678906" as people read it. */
const formatIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();
