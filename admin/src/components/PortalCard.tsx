import { Copy, LinkSimple, SignOut, UserPlus, WhatsappLogo } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useCurrentUser } from '../auth/useAuth';
import { canManage } from '../auth/roles';
import { useT } from '../i18n/useT';
import { businessApi } from '../services/api';
import { portalAdminApi, type ShopPortal } from '../services/portalAdminApi';
import type { PortalLanguage } from '../services/portalApi';
import { errorMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';
import { whatsappLink } from '../utils/whatsapp';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, Card, Field, RemoveButton, SettingRow, Sheet, useToast } from './ui';
import { buttonClass } from './ui/buttonClass';

/**
 * Step 15: the customer page's switch for the business customers' portal.
 * Only the owner (or whoever may manage) sees it: they decide who gets in.
 */
export function PortalCard({ customerId, phone }: { customerId: number; phone: string | null }) {
  const { role } = useCurrentUser();
  if (role !== 'owner' && !canManage(role)) return null;
  return <PortalCardBody customerId={customerId} phone={phone} />;
}

type Draft = { enabled: boolean; canOrder: boolean; minOrder: string; categories: number[] | null };
const toDraft = (portal: ShopPortal): Draft => ({ enabled: portal.enabled, canOrder: portal.canOrder, minOrder: portal.minOrder === null ? '' : String(portal.minOrder), categories: portal.categories });

function PortalCardBody({ customerId, phone }: { customerId: number; phone: string | null }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['portal-admin', customerId];
  const portal = useQuery({ queryKey: key, queryFn: () => portalAdminApi.settings(customerId) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ url: string; name: string; phone: string | null; emailedTo: string | null } | null>(null);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      portalAdminApi.save(customerId, { enabled: d.enabled, canOrder: d.canOrder, minOrder: d.minOrder.trim() ? Number(d.minOrder.replace(',', '.')) : null, categories: d.categories }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(key, fresh);
      setDraft(null);
      toast({ title: t.portalShop.saved, tone: 'ok' });
    },
  });
  const remove = useMutation({
    mutationFn: (personId: number) => portalAdminApi.remove(customerId, personId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      toast({ title: t.portalShop.removed });
    },
  });
  const newLink = useMutation({
    mutationFn: (person: { id: number; name: string; phone: string | null }) => portalAdminApi.newLink(customerId, person.id, false).then((result) => ({ ...result, person })),
    onSuccess: ({ link: url, person }) => {
      setLink({ url, name: person.name, phone: person.phone, emailedTo: null });
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const signOutAll = useMutation({
    mutationFn: () => portalAdminApi.signOutAll(customerId),
    onSuccess: () => toast({ title: t.portalShop.signedOutAll }),
  });

  if (portal.isPending) return <Loading />;
  if (portal.isError) return <ErrorNotice error={portal.error} onRetry={() => portal.refetch()} />;
  const saved = portal.data;
  const current = draft ?? toDraft(saved);
  const changed = draft !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(saved));
  const minInvalid = current.minOrder.trim() !== '' && !(Number(current.minOrder.replace(',', '.')) > 0);
  const change = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });

  return (
    <Card
      title={t.portalShop.card}
      description={t.portalShop.cardHint}
      footer={
        changed ? (
          <Button variant="primary" onClick={() => save.mutate(current)} loading={save.isPending} disabled={minInvalid || (current.categories !== null && current.categories.length === 0)}>
            {t.portalShop.save}
          </Button>
        ) : undefined
      }
    >
      <SettingRow title={t.portalShop.enabled} description={t.portalShop.enabledHint}>
        <input type="checkbox" role="switch" className="switch" aria-label={t.portalShop.enabled} checked={current.enabled} onChange={(event) => change({ enabled: event.target.checked })} />
      </SettingRow>
      {current.enabled && (
        <>
          <SettingRow title={t.portalShop.canOrder} description={t.portalShop.canOrderHint}>
            <input type="checkbox" role="switch" className="switch" aria-label={t.portalShop.canOrder} checked={current.canOrder} onChange={(event) => change({ canOrder: event.target.checked })} />
          </SettingRow>
          <div className="portal-admin__fields">
            <Field label={t.portalShop.minOrder} hint={t.portalShop.minOrderHint} error={minInvalid ? t.portalShop.minOrderHint : undefined} narrow>
              <input inputMode="decimal" autoComplete="off" value={current.minOrder} onChange={(event) => change({ minOrder: event.target.value })} />
            </Field>
            <fieldset className="portal-admin__categories">
              <legend>{t.portalShop.categories}</legend>
              <label className="toggle">
                <input type="radio" name={`portal-cats-${customerId}`} checked={current.categories === null} onChange={() => change({ categories: null })} />
                {t.portalShop.allProducts}
              </label>
              <label className="toggle">
                <input type="radio" name={`portal-cats-${customerId}`} checked={current.categories !== null} onChange={() => change({ categories: current.categories ?? [] })} />
                {t.portalShop.chosenCategories}
              </label>
              {current.categories !== null && (
                <div className="portal-admin__category-list">
                  {saved.allCategories.map((category) => (
                    <label key={category.id} className="toggle">
                      <input
                        type="checkbox"
                        checked={current.categories!.includes(category.id)}
                        onChange={(event) => change({ categories: event.target.checked ? [...current.categories!, category.id] : current.categories!.filter((id) => id !== category.id) })}
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </div>
        </>
      )}
      {save.isError && (
        <p className="notice notice--error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}

      <div className="portal-admin__people">
        <div className="portal-admin__people-head">
          <h3 className="portal-admin__subtitle">{t.portalShop.people}</h3>
          <div className="portal-admin__people-actions">
            {saved.people.length > 0 && (
              <Button size="sm" icon={SignOut} onClick={() => signOutAll.mutate()} loading={signOutAll.isPending}>
                {t.portalShop.signOutAll}
              </Button>
            )}
            <Button size="sm" icon={UserPlus} onClick={() => setInviting(true)} disabled={!saved.enabled}>
              {t.portalShop.invite}
            </Button>
          </div>
        </div>
        {!saved.enabled && <p className="portal-muted">{t.portalShop.turnOnFirst}</p>}
        {saved.people.length === 0 ? (
          <p className="portal-muted">{t.portalShop.noPeople}</p>
        ) : (
          <ul className="portal-admin__list">
            {saved.people.map((person) => (
              <li key={person.id} className="portal-admin__person">
                <span className="portal-row__main">
                  <span className="portal-row__title">{person.name}</span>
                  <span className="portal-row__meta">
                    {[person.email, person.phone, person.lastSeenAt ? t.portalShop.lastSeen(formatDateTime(person.lastSeenAt)) : t.portalShop.neverSeen].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {person.invitePending && <Badge tone="info">{t.portalShop.invitePending}</Badge>}
                <Button size="sm" variant="ghost" icon={LinkSimple} onClick={() => newLink.mutate(person)} disabled={!saved.enabled} loading={newLink.isPending && newLink.variables?.id === person.id}>
                  {t.portalShop.newLink}
                </Button>
                <RemoveButton aria-label={t.portalShop.remove(person.name)} confirm={t.portalShop.removeConfirm} onConfirm={() => remove.mutate(person.id)} pending={remove.isPending && remove.variables === person.id} />
              </li>
            ))}
          </ul>
        )}
        {(remove.isError || newLink.isError || signOutAll.isError) && (
          <p className="notice notice--error" role="alert">
            {errorMessage(remove.error ?? newLink.error ?? signOutAll.error)}
          </p>
        )}
      </div>

      <Sheet open={inviting} onClose={() => setInviting(false)} title={t.portalShop.invite}>
        <InviteForm
          customerId={customerId}
          phone={phone}
          onDone={(result) => {
            setInviting(false);
            setLink(result);
            queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      </Sheet>
      <Sheet open={link !== null} onClose={() => setLink(null)} title={t.portalShop.linkReady} description={t.portalShop.linkHint}>
        {link && <LinkShare link={link} onDone={() => setLink(null)} />}
      </Sheet>
    </Card>
  );
}

function InviteForm({ customerId, phone, onDone }: { customerId: number; phone: string | null; onDone: (link: { url: string; name: string; phone: string | null; emailedTo: string | null }) => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState(phone ?? '');
  const [language, setLanguage] = useState<PortalLanguage>('sq');
  const [sendEmail, setSendEmail] = useState(false);
  const invite = useMutation({
    mutationFn: () => portalAdminApi.invite(customerId, { name: name.trim(), email: email.trim() || null, phone: mobile.trim() || null, language, sendEmail: sendEmail && email.trim() !== '' }),
    onSuccess: (result) => onDone({ url: result.link, name: result.person.name, phone: result.person.phone, emailedTo: result.emailed ? result.person.email : null }),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    invite.mutate();
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <Field label={t.portalShop.name}>
        <input required maxLength={120} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t.portalShop.email} hint={t.portalShop.emailHint}>
        <input type="email" maxLength={254} autoComplete="off" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      {email.includes('@') && (
        <label className="toggle">
          <input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} />
          {t.portalShop.sendEmail}
        </label>
      )}
      <Field label={t.portalShop.phone}>
        <input type="tel" maxLength={40} autoComplete="off" value={mobile} onChange={(event) => setMobile(event.target.value)} />
      </Field>
      <Field label={t.portalShop.language}>
        <select value={language} onChange={(event) => setLanguage(event.target.value as PortalLanguage)}>
          <option value="sq">{t.language.albanian}</option>
          <option value="en">{t.language.english}</option>
        </select>
      </Field>
      {invite.isError && (
        <p className="notice notice--error" role="alert">
          {errorMessage(invite.error)}
        </p>
      )}
      <Button type="submit" variant="primary" loading={invite.isPending} disabled={!name.trim()}>
        {t.portalShop.create}
      </Button>
    </form>
  );
}

function LinkShare({ link, onDone }: { link: { url: string; name: string; phone: string | null; emailedTo: string | null }; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const chat = link.phone ? whatsappLink(link.phone, t.portalShop.whatsappText(business.data?.name ?? '4VD', link.url)) : null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      toast({ title: t.portalShop.copied });
    } catch {
      // No clipboard (an old browser): the link is selectable below.
    }
  }
  return (
    <div className="form-stack">
      <p className="portal-admin__link" translate="no">
        {link.url}
      </p>
      {link.emailedTo && <p className="portal-muted">{t.portalShop.emailed(link.emailedTo)}</p>}
      <div className="portal-admin__people-actions">
        {chat && (
          <a href={chat} target="_blank" rel="noreferrer" className={buttonClass({ variant: 'primary' })}>
            <WhatsappLogo aria-hidden="true" />
            {t.portalShop.whatsapp}
          </a>
        )}
        <Button icon={Copy} onClick={copy}>
          {t.portalShop.copy}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t.portalShop.done}
        </Button>
      </div>
    </div>
  );
}
