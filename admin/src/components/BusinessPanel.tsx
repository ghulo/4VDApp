import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { businessApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { Business } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { LogoMark } from './LogoMark';
import { Button, Card, Field, SettingRow } from './ui';
import { useT } from '../i18n/useT';

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
  if (business.isPending) return <Loading />;
  if (business.isError) return <ErrorNotice error={business.error} onRetry={() => business.refetch()} />;
  return <BusinessForm initial={business.data} />;
}

function BusinessForm({ initial }: { initial: Business }) {
  const t = useT();
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
    timeZone !== (initial.timeZone ?? '');

  return (
    <form onSubmit={handleSubmit}>
      <Card
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
              <span className="form-success" role="status">
                {t.settings.saved}
              </span>
            )}
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!name.trim() || save.isPending}>
              {save.isPending ? t.settings.saving : t.business.save}
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
          {logo ? <img className="business-logo" src={mediaSrc(logo)!} alt="" width={72} height={72} /> : <LogoMark size={48} />}
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickLogo} />
          <Button disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
            {upload.isPending ? t.profile.uploading : logo ? t.profile.change : t.business.addLogo}
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
        </div>
      </Card>
    </form>
  );
}
