import { useState } from 'react';
import { useT } from '../i18n/useT';
import type { PartnerDetails } from '../services/types';
import { Field } from './ui';

const KEYS = ['address', 'city', 'businessNo', 'fiscalNo', 'vatNo', 'iban', 'contactPerson', 'mobile'] as const satisfies ReadonlyArray<keyof PartnerDetails>;
const MAX_LENGTH: Record<keyof PartnerDetails, number> = { address: 200, city: 80, businessNo: 40, fiscalNo: 40, vatNo: 40, iban: 60, contactPerson: 120, mobile: 40 };

export type PartnerDraft = Record<keyof PartnerDetails, string>;

/** A form's copy of a supplier's or customer's details, and what to send when saving. */
export function usePartnerDraft(partner: Partial<PartnerDetails> | null) {
  const [draft, setDraft] = useState<PartnerDraft>(() => Object.fromEntries(KEYS.map((key) => [key, partner?.[key] ?? ''])) as PartnerDraft);
  const values = (): PartnerDetails => Object.fromEntries(KEYS.map((key) => [key, draft[key].trim() || null])) as unknown as PartnerDetails;
  const reset = () => setDraft(Object.fromEntries(KEYS.map((key) => [key, ''])) as PartnerDraft);
  return { draft, setDraft, values, reset };
}

/** The details as form fields, folded under "More details" unless one is filled in. */
export function PartnerDetailFields({ draft, setDraft }: { draft: PartnerDraft; setDraft: (next: PartnerDraft) => void }) {
  const t = useT();
  // Open at first when something is filled in; after that the person opens and closes it.
  const [open] = useState(() => KEYS.some((key) => draft[key].trim() !== ''));
  const field = (key: keyof PartnerDetails, type: 'text' | 'tel' = 'text') => (
    <Field label={t.partner[key]}>
      <input
        type={type}
        maxLength={MAX_LENGTH[key]}
        autoComplete="off"
        spellCheck={false}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
      />
    </Field>
  );
  return (
    <details className="fallback" open={open}>
      <summary>{t.partner.moreDetails}</summary>
      <div className="field-row">
        {field('address')}
        {field('city')}
      </div>
      <div className="field-row">
        {field('businessNo')}
        {field('fiscalNo')}
      </div>
      <div className="field-row">
        {field('vatNo')}
        {field('iban')}
      </div>
      <div className="field-row">
        {field('contactPerson')}
        {field('mobile', 'tel')}
      </div>
    </details>
  );
}

/** Whether any of the details is filled in. */
export const hasDetails = (partner: PartnerDetails) => KEYS.some((key) => partner[key]);

/** The details that are filled in, as a short list; nothing when none are. */
export function PartnerFacts({ partner, extra = [] }: { partner: PartnerDetails; extra?: Array<{ label: string; value: string }> }) {
  const t = useT();
  const rows = [...KEYS.filter((key) => partner[key]).map((key) => ({ label: t.partner[key], value: partner[key]! })), ...extra];
  if (rows.length === 0) return null;
  return (
    <dl className="partner-facts">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
