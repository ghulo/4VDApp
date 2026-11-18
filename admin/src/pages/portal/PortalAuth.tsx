import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BrandMark } from '../../components/BrandMark';
import type { Brand } from '../../services/types';
import { showBrand } from '../../theme/applyBrand';
import { useLinkBrand } from '../../theme/useLinkBrand';
import { Button, ButtonLink, Field } from '../../components/ui';
import { useLanguage, useT } from '../../i18n/useT';
import { ApiError } from '../../services/apiClient';
import { portalApi } from '../../services/portalApi';
import { ThemeSwitch } from '../../theme/ThemeSwitch';
import { PortalLanguagePick } from './PortalParts';

/** The calm frame around signing in: the mark, one card, language and theme. */
export function PortalAuthShell({ title, subtitle, children, brand }: { title: string; subtitle?: ReactNode; children: ReactNode; brand?: Brand | null }) {
  const t = useT();
  return (
    <main className="portal-auth">
      <div className="portal-auth__card">
        <BrandMark brand={brand} size={56} />
        <h1 className="portal-auth__title">{title}</h1>
        {subtitle && <p className="portal-auth__subtitle">{subtitle}</p>}
        {children}
        {brand && !brand.house && <small className="portal-auth__runs">{t.nav.runsOn}</small>}
        <div className="portal-auth__prefs">
          <ThemeSwitch />
          <PortalLanguagePick />
        </div>
      </div>
    </main>
  );
}

/** "Send me a link": the same answer whether or not the address is known. */
export function PortalSignInPage() {
  const t = useT();
  const linkBrand = useLinkBrand();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState('sending');
    setError(null);
    try {
      await portalApi.requestLink(email.trim());
      setState('sent');
    } catch (failure) {
      setState('error');
      setError(failure instanceof ApiError && failure.status === 429 ? t.portal.signIn.tooMany : failure instanceof ApiError && failure.code === 'NETWORK' ? t.portal.errors.offline : t.portal.errors.generic);
    }
  }

  return (
    <PortalAuthShell brand={linkBrand} title={t.portal.signIn.title} subtitle={t.portal.signIn.lead}>
      {state === 'sent' ? (
        <p className="notice notice--ok" role="status">
          {t.portal.signIn.sent}
        </p>
      ) : (
        <form className="portal-auth__form" onSubmit={submit} noValidate={false}>
          <Field label={t.portal.signIn.email} error={error ?? undefined}>
            <input type="email" required autoComplete="email" inputMode="email" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Button type="submit" variant="primary" wide loading={state === 'sending'} disabled={!email.includes('@')}>
            {t.portal.signIn.send}
          </Button>
        </form>
      )}
      <p className="portal-auth__muted">{t.portal.signIn.noEmail}</p>
    </PortalAuthShell>
  );
}

/**
 * An invite or an emailed sign-in link. The token sits after the # so it never
 * reaches a server log. Opening the page spends nothing (WhatsApp and Viber
 * open links themselves to draw a preview); the button does.
 */
export function PortalLinkPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setLanguage } = useLanguage();
  const token = useRef(window.location.hash.replace(/^#/, ''));
  const [info, setInfo] = useState<Awaited<ReturnType<typeof portalApi.peek>> | null>(null);
  const infoBrand = info?.brand;
  useEffect(() => showBrand(infoBrand), [infoBrand]);
  const [dead, setDead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Off the address bar at once, so it isn't left in the history or shared by accident.
    window.history.replaceState(null, '', window.location.pathname);
    if (!token.current) {
      setDead(true);
      return;
    }
    portalApi
      .peek(token.current)
      .then(setInfo)
      .catch(() => setDead(true));
  }, []);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      await portalApi.useLink(token.current);
      const me = await portalApi.me();
      setLanguage(me.person.language);
      queryClient.setQueryData(['portal', 'me'], me);
      navigate('/portal/order', { replace: true });
    } catch (failure) {
      setBusy(false);
      if (failure instanceof ApiError && failure.status === 404) setDead(true);
      else setError(failure instanceof ApiError && failure.code === 'NETWORK' ? t.portal.errors.offline : t.portal.errors.generic);
    }
  }

  if (dead) {
    return (
      <PortalAuthShell title={t.portal.link.dead} subtitle={t.portal.link.deadHint}>
        <ButtonLink to="/portal" variant="primary" className="button--wide">
          {t.portal.link.toSignIn}
        </ButtonLink>
      </PortalAuthShell>
    );
  }
  if (!info) {
    return (
      <PortalAuthShell title={t.portal.link.checking}>
        <p className="loading" role="status">
          {t.portal.link.checking}
        </p>
      </PortalAuthShell>
    );
  }
  return (
    <PortalAuthShell brand={info.brand} title={info.purpose === 'invite' ? t.portal.link.inviteTitle(info.shop) : t.portal.link.signInTitle(info.shop)} subtitle={t.portal.link.forWhom(info.name, info.customer)}>
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      <Button variant="primary" wide loading={busy} onClick={open}>
        {t.portal.link.button}
      </Button>
      <p className="portal-auth__muted">{t.portal.link.stays}</p>
    </PortalAuthShell>
  );
}
