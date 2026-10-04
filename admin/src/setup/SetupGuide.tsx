import { useQuery } from '@tanstack/react-query';
import { Check } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { businessApi, invitesApi, productsApi, pushApi, usersApi } from '../services/api';
import { Button, ButtonLink } from '../components/ui';
import { setupSteps } from './steps';
import { useCurrentUser } from '../auth/useAuth';
import { canManage } from '../auth/roles';
import { useT } from '../i18n/useT';

const HIDDEN_KEY = '4vd.setupGuide.hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === 'yes';
  } catch {
    return false;
  }
}

/**
 * A new shop's checklist on Overview, until it's done or hidden: one slim strip
 * with the progress and the next step, opening into every step.
 */
export function SetupGuide() {
  const t = useT();
  const { role } = useCurrentUser();
  const [hidden, setHidden] = useState(() => readHidden() || !canManage(role));
  const [open, setOpen] = useState(false);
  const listId = useId();
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get, enabled: !hidden });
  const products = useQuery({
    queryKey: ['products', { page: 1, limit: 1, purpose: 'count' }],
    queryFn: () => productsApi.list({ page: 1, limit: 1 }),
    enabled: !hidden,
  });
  const people = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1), enabled: !hidden });
  const invites = useQuery({ queryKey: ['invites'], queryFn: invitesApi.list, enabled: !hidden });
  const alerts = useQuery({ queryKey: ['push-settings'], queryFn: pushApi.settings, enabled: !hidden });

  const loaded = business.data && products.data && people.data && invites.data && alerts.data;
  if (hidden || !loaded) return null;

  const steps = setupSteps({
    business: business.data,
    productCount: products.data.meta.total,
    peopleCount: people.data.meta.total,
    openInvites: invites.data.length,
    alertDevices: alerts.data.deviceCount,
  }, t);
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;

  function hide() {
    setHidden(true);
    try {
      localStorage.setItem(HIDDEN_KEY, 'yes');
    } catch {
      // Blocked storage: hidden for this visit only.
    }
  }

  const next = steps.find((step) => !step.done)!;

  return (
    <section className="setup-strip" aria-label={t.setup.title}>
      <div className="setup-strip__row">
        <div className="setup-strip__progress">
          <p className="setup-strip__title">
            {t.setup.title} <span>{t.setup.progress(done, steps.length)}</span>
          </p>
          <div className="setup-strip__bar" aria-hidden="true">
            <span style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
        </div>
        <p className="setup-strip__next">{t.setup.next(next.title)}</p>
        <div className="setup-strip__actions">
          <ButtonLink to={next.to} size="sm">
            {next.action}
          </ButtonLink>
          <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
            {open ? t.setup.fewerSteps : t.setup.allSteps}
          </Button>
          <Button variant="ghost" size="sm" onClick={hide}>
            {t.setup.hide}
          </Button>
        </div>
      </div>
      <ol className="setup-guide__steps" id={listId} hidden={!open}>
        {steps.map((step) => (
          <li key={step.id} className={step.done ? 'setup-step setup-step--done' : 'setup-step'}>
            <span className="setup-step__check" aria-hidden="true">
              {step.done && <Check size={14} weight="bold" />}
            </span>
            <span className="setup-step__text">
              <span className="setup-step__title">
                {step.title}
                {step.done && <span className="visually-hidden"> {t.common.done}</span>}
              </span>
              {!step.done && <span className="setup-step__why">{step.why}</span>}
            </span>
            {!step.done && step.id !== next.id && (
              <ButtonLink to={step.to} size="sm">
                {step.action}
              </ButtonLink>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
