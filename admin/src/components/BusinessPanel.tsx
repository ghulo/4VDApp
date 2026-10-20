import { ImageSquare } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { businessApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { Business } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading, SavedToast } from './Feedback';
import { Button, Card, Field, SettingRow } from './ui';
import { useT } from '../i18n/useT';
import { cleanNui, isNui, NuiInput } from './NuiInput';
import { HistoryCard } from './HistoryCard';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** An IBAN the way the server keeps it: no spaces, capitals. */
const cleanIban = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** Empty, or an IBAN whose check digits match (ISO 13616 mod 97), the same check the server makes. */
function isIbanOrEmpty(value: string): boolean {
  const iban = cleanIban(value);
  if (!iban) return true;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

// The time zones people in and around the shop's region are most likely to need, then everything else.
const COMMON_ZONES = ['Europe/Belgrade', 'Europe/Budapest', 'Europe/Tirane', 'Europe/Skopje', 'Europe/Berlin', 'Europe/London'];

function allTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return [...COMMON_ZONES, ...supported.filter((zone) => !COMMON_ZONES.includes(zone))];
}

/** The shop's own details, shown to staff and used for dates, emails and (later) receipts. */
export function BusinessPanel() {
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  if (business.isPending) return <Loading />;
  if (business.isError) return <ErrorNotice error={business.error} onRetry={() => business.refetch()} />;
  return (
    <>
      <BusinessForm initial={business.data} />
      <HistoryCard entityType="business" entityId={business.data.id} />
    </>
  );
}

function BusinessForm({ initial }: { initial: Business }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [nui, setNui] = useState(initial.nui ?? '');
  const [timeZone, setTimeZone] = useState(initial.timeZone ?? '');
  const [bankName, setBankName] = useState(initial.bankName ?? '');
  const [iban, setIban] = useState(initial.iban ?? '');
  const [invoiceNote, setInvoiceNote] = useState(initial.invoiceNote ?? '');
  // Checked once the person leaves the box, so half-typed numbers aren't flagged.
  const [ibanLeft, setIbanLeft] = useState(false);
  const ibanOk = isIbanOrEmpty(iban);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const keep = (updated: Business) => queryClient.setQueryData(['business'], updated);

  const save = useMutation({
    mutationFn: () =>
      businessApi.update({
        name: name.trim(),
        address: address.trim() || null,
        phone: phone.trim() || null,
        nui: cleanNui(nui),
        timeZone: timeZone || null,
        bankName: bankName.trim() || null,
        iban: iban.trim() || null,
        invoiceNote: invoiceNote.trim() || null,
      }),
    onSuccess: keep,
  });
  const upload = useMutation({ mutationFn: businessApi.uploadLogo, onSuccess: keep });
  const remove = useMutation({ mutationFn: businessApi.removeLogo, onSuccess: keep });
  const logo = queryClient.getQueryData<Business>(['business'])?.logoUrl ?? initial.logoUrl;

  function pickLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setLogoError(null);
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(t.business.tooBig);
      return;
    }
    upload.mutate(file);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  // Save only turns orange once there's something to save, like the other settings card.
  const hasChanges =
    name.trim() !== initial.name ||
    address.trim() !== (initial.address ?? '') ||
    phone.trim() !== (initial.phone ?? '') ||
    cleanNui(nui) !== (initial.nui ?? '') ||
    timeZone !== (initial.timeZone ?? '') ||
    bankName.trim() !== (initial.bankName ?? '') ||
    cleanIban(iban) !== (initial.iban ?? '') ||
    invoiceNote.trim() !== (initial.invoiceNote ?? '');

  return (
    <form onSubmit={handleSubmit}>
      <Card
        id="shop"
        title={t.business.title}
        description={t.business.description}
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {save.isSuccess && (
              <SavedToast message={t.settings.saved} />
            )}
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!name.trim() || !isNui(nui) || !ibanOk || save.isPending} loading={save.isPending}>
              {t.business.save}
            </Button>
          </>
        }
      >
        <SettingRow
          title={t.business.logo}
          description={
            logoError || upload.isError || remove.isError ? (
              <span className="form-error" role="alert">
                {logoError ?? errorMessage(upload.error ?? remove.error)}
              </span>
            ) : (
              t.business.logoHint
            )
          }
        >
          {/* No logo yet: an empty frame, not 4VD's own mark, which looked like a logo was already set. */}
          {logo ? (
            <img className="business-logo" src={mediaSrc(logo)!} alt="" width={72} height={72} />
          ) : (
            <span className="business-logo business-logo--empty" aria-hidden="true">
              <ImageSquare size={22} />
            </span>
          )}
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickLogo} />
          <Button disabled={upload.isPending} onClick={() => fileInput.current?.click()} loading={upload.isPending}>
            {logo ? t.profile.change : t.business.addLogo}
          </Button>
          {logo && (
            <Button variant="danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t.profile.remove}
            </Button>
          )}
        </SettingRow>
        <div className="setting-row setting-row--fields">
          <Field label={t.business.shopName}>
            <input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t.nui.label} hint={t.business.nuiHint}>
            <NuiInput required value={nui} onChange={(event) => setNui(event.target.value)} />
          </Field>
          <Field label={t.business.address}>
            <input maxLength={500} autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} />
          </Field>
          <div className="field-row">
            <Field label={t.profile.phone}>
              <input type="tel" maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
            <Field label={t.business.timeZone}>
              <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                <option value="">{t.business.serverDefault}</option>
                {allTimeZones().map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="field-row">
            <Field label={t.business.bankName}>
              <input maxLength={100} autoComplete="off" value={bankName} onChange={(event) => setBankName(event.target.value)} />
            </Field>
            <Field label={t.business.iban} hint={t.business.ibanHint} error={ibanLeft && !ibanOk ? t.business.ibanInvalid : undefined}>
              <input
                maxLength={42}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder={t.business.ibanExample}
                value={iban}
                onChange={(event) => setIban(event.target.value)}
                onBlur={() => setIbanLeft(true)}
                aria-invalid={ibanLeft && !ibanOk}
              />
            </Field>
          </div>
          <Field label={t.business.invoiceNote} hint={t.business.invoiceNoteHint}>
            <textarea rows={2} maxLength={500} value={invoiceNote} onChange={(event) => setInvoiceNote(event.target.value)} />
          </Field>
        </div>
      </Card>
    </form>
  );
}
