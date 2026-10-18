import { useSearchParams } from 'react-router';
import type { Catalogue } from '../i18n/en';
import { addMonths, thisMonth } from './vat';

/** The month a VAT page shows, kept in the address; last month by default, the one most likely to file. */
export function useMonthParam() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('month');
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : addMonths(thisMonth(), -1);
  const setMonth = (next: string) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set('month', next);
        return updated;
      },
      { replace: true },
    );
  return [month, setMonth] as const;
}

/** A VAT form line's words, by its part and key. */
export const rowWords = (t: Catalogue, part: 'charged' | 'claim', key: string) =>
  (t.vat.rows[part] as Record<string, { label: string; hint: string }>)[key] ?? { label: key, hint: '' };
