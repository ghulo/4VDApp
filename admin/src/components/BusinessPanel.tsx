import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { businessApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { Business } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { LogoMark } from './LogoMark';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
// The time zones people in and around the shop's region are most likely to need, then everything else.
const COMMON_ZONES = ['Europe/Belgrade', 'Europe/Budapest', 'Europe/Tirane', 'Europe/Skopje', 'Europe/Berlin', 'Europe/London'];

function allTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return [...COMMON_ZONES, ...supported.filter((zone) => !COMMON_ZONES.includes(zone))];
}

/** The shop's own details, shown to staff and used for dates, emails and (later) receipts. */
export function BusinessPanel() {
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  return (
    <section className="panel">
      <h2 className="panel__title">Your shop</h2>
      {business.isPending && <Loading />}
      {business.isError && <ErrorNotice error={business.error} onRetry={() => business.refetch()} />}
      {business.data && <BusinessForm initial={business.data} />}
    </section>
  );
}

function BusinessForm({ initial }: { initial: Business }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [timeZone, setTimeZone] = useState(initial.timeZone ?? '');
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const keep = (updated: Business) => queryClient.setQueryData(['business'], updated);

  const save = useMutation({
    mutationFn: () =>
      businessApi.update({ name: name.trim(), address: address.trim() || null, phone: phone.trim() || null, timeZone: timeZone || null }),
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
      setLogoError('That file is too big. Use one under 5 MB.');
      return;
    }
    upload.mutate(file);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <>
      <div className="profile-photo">
        {logo ? <img className="business-logo" src={mediaSrc(logo)!} alt="" /> : <LogoMark size={72} />}
        <div className="profile-photo__actions">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickLogo} />
          <button type="button" className="button button--quiet" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
            {upload.isPending ? 'Uploading…' : logo ? 'Change logo' : 'Add your logo'}
          </button>
          {logo && (
            <button type="button" className="button button--quiet button--danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </button>
          )}
        </div>
      </div>
      {(logoError || upload.isError || remove.isError) && (
        <p className="form-error" role="alert">
          {logoError ?? errorMessage(upload.error ?? remove.error)}
        </p>
      )}
      <form className="settings-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">Shop name</span>
          <input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} />
          <span className="field-hint">Shown in invites and emails.</span>
        </label>
        <label className="field">
          <span className="field__label">Address (optional)</span>
          <input maxLength={500} autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Phone (optional)</span>
            <input type="tel" maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Time zone</span>
            <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
              <option value="">Server default</option>
              {allTimeZones().map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        </div>
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        {save.isSuccess && (
          <p className="form-success" role="status">
            Saved.
          </p>
        )}
        <button type="submit" className="button button--primary" disabled={!name.trim() || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save shop details'}
        </button>
      </form>
    </>
  );
}
