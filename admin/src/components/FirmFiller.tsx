import { ArrowSquareOut, Camera, ClipboardText } from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import { partnersApi } from '../services/api';
import type { CustomerKind, FirmReading, PartnerDetails, PartnerMatch } from '../services/types';
import { errorMessage } from '../utils/errors';
import { toPage } from './BillScanParts';
import { Button, buttonClass, Field } from './ui';

/** The business register's search page: it sits behind a robot check, so people open it themselves. */
export const ARBK_URL = 'https://arbk.rks-gov.net/';
const MAX_BYTES = 10 * 1024 * 1024;

/** What a firm's form takes from a look-up or a reading; only what was found is set. */
export type FirmFill = Partial<PartnerDetails & { name: string; kind: CustomerKind; nui: string; phone: string; email: string }>;

const KEYS = ['address', 'city', 'businessNo', 'fiscalNo', 'vatNo', 'iban', 'contactPerson', 'mobile'] as const;
const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

function fromReading(reading: FirmReading): FirmFill {
  const fill: FirmFill = { kind: reading.kind };
  for (const key of ['name', 'nui', 'phone', 'email', ...KEYS] as const) if (reading[key].trim()) fill[key] = reading[key].trim();
  return fill;
}

function fromMatch(match: PartnerMatch): FirmFill {
  const fill: FirmFill = { kind: match.kind, name: match.name };
  for (const key of ['nui', 'phone', 'email', ...KEYS] as const) if (match[key]) fill[key] = match[key]!;
  return fill;
}

/** Waits until typing stops before the value counts. */
function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Above a new customer's or supplier's form: read their details off a photo
 * or pasted text, open the business register, and, as the name or NUI is
 * typed, what 4VD already has (a duplicate, or the same firm on the other list).
 */
export function FirmFiller({ side, name, nui, onFill }: { side: 'customer' | 'supplier'; name: string; nui: string; onFill: (fill: FirmFill) => void }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const pasteId = useId();
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [filled, setFilled] = useState<'photo' | 'text' | 'match' | null>(null);

  const read = useMutation({
    mutationFn: async (source: { text?: string; file?: File }) =>
      partnersApi.read({ side, ...(source.text ? { text: source.text } : { pages: [await toPage(source.file!)] }) }),
    onSuccess: (reading, source) => {
      onFill(fromReading(reading));
      setFilled(source.text ? 'text' : 'photo');
      if (source.text) {
        setPasting(false);
        setText('');
      }
    },
  });

  const query = useSettled({ nui: digits(nui), q: name.trim() });
  const lookup = useQuery({
    queryKey: ['partners', 'lookup', query],
    queryFn: () => partnersApi.lookup(query.nui.length >= 3 ? { nui: query.nui } : { q: query.q }),
    enabled: query.nui.length >= 3 || query.q.length >= 2,
    staleTime: 30_000,
  });
  const matches = lookup.data ?? [];

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setProblem(t.firm.tooBig);
      return;
    }
    setProblem(null);
    read.mutate({ file });
  }

  return (
    <div className="firm-fill callout" role="group" aria-label={t.firm.title}>
      <div className="firm-fill__head">
        <span className="firm-fill__title">{t.firm.title}</span>
        <div className="firm-fill__keys">
          <Button size="sm" icon={Camera} loading={read.isPending && !read.variables?.text} disabled={read.isPending} onClick={() => fileRef.current?.click()}>
            {t.firm.photo}
          </Button>
          <Button size="sm" icon={ClipboardText} aria-expanded={pasting} aria-controls={pasteId} onClick={() => setPasting((open) => !open)}>
            {t.firm.paste}
          </Button>
          <a className={buttonClass({ size: 'sm', variant: 'ghost' })} href={ARBK_URL} target="_blank" rel="noreferrer">
            {t.firm.arbk}
            <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
            <span className="visually-hidden">{t.firm.newTab}</span>
          </a>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = '';
        }}
      />
      {pasting && (
        <div id={pasteId} className="firm-fill__paste">
          <Field label={t.firm.pasteLabel} hint={t.firm.pasteHint}>
            <textarea rows={5} maxLength={20_000} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
          </Field>
          <Button size="sm" variant="primary" loading={read.isPending && Boolean(read.variables?.text)} disabled={text.trim() === '' || read.isPending} onClick={() => read.mutate({ text })}>
            {t.firm.readIt}
          </Button>
        </div>
      )}
      <p className="field-hint" role="status">
        {read.isPending ? t.firm.reading : filled ? t.firm.filled[filled] : t.firm.hint}
      </p>
      {(problem || read.isError) && (
        <p className="form-error" role="alert">
          {problem ?? errorMessage(read.error)}
        </p>
      )}
      {matches.length > 0 && (
        <ul className="firm-fill__matches" aria-label={t.firm.already}>
          {matches.map((match) => {
            const same = match.side === side;
            const sameNui = digits(match.nui).length >= 8 && digits(match.nui) === digits(nui);
            return (
              <li key={`${match.side}-${match.id}`} className={same && sameNui ? 'firm-fill__match firm-fill__match--twin' : 'firm-fill__match'}>
                <span>
                  <strong>{match.name}</strong>
                  <span className="table__secondary">
                    {[t.firm.sides[match.side], match.nui && t.nui.short(match.nui), match.city, match.archived && t.firm.archived].filter(Boolean).join(' · ')}
                  </span>
                  {same && sameNui && <span className="firm-fill__warn">{t.firm.twin}</span>}
                </span>
                {same ? (
                  <Link className={buttonClass({ size: 'sm', variant: 'ghost' })} to={match.side === 'customer' ? `/customers/${match.id}` : `/suppliers/${match.id}`}>
                    {t.firm.open}
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      onFill(fromMatch(match));
                      setFilled('match');
                    }}
                  >
                    {t.firm.use}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Puts a fill into a partner draft, keeping what isn't in the fill. */
export function mergeDetails<T extends Record<string, string>>(draft: T, fill: FirmFill): T {
  const next = { ...draft };
  for (const key of KEYS) if (fill[key] && key in next) (next as Record<string, string>)[key] = fill[key]!;
  return next;
}
