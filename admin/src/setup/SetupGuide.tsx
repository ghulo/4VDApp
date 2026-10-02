import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { businessApi, invitesApi, productsApi, pushApi, usersApi } from '../services/api';
import { setupSteps } from './steps';

const HIDDEN_KEY = '4vd.setupGuide.hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === 'yes';
  } catch {
    return false;
  }
}

/** A checklist for a new shop at the top of Overview, until it's done or hidden. */
export function SetupGuide() {
  const [hidden, setHidden] = useState(readHidden);
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
  });
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

  return (
    <section className="panel setup-guide" aria-labelledby="setup-heading">
      <div className="panel__header">
        <div>
          <h2 id="setup-heading" className="panel__title">
            Get 4VD ready
          </h2>
          <p className="setup-guide__progress">
            {done} of {steps.length} done
          </p>
        </div>
        <button type="button" className="button button--quiet" onClick={hide}>
          Hide
        </button>
      </div>
      <div className="setup-guide__bar" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="setup-guide__steps">
        {steps.map((step) => (
          <li key={step.id} className={step.done ? 'setup-step setup-step--done' : 'setup-step'}>
            <span className="setup-step__check" aria-hidden="true">
              {step.done ? '✓' : ''}
            </span>
            <span className="setup-step__text">
              <span className="setup-step__title">
                {step.title}
                {step.done && <span className="visually-hidden"> (done)</span>}
              </span>
              {!step.done && <span className="setup-step__why">{step.why}</span>}
            </span>
            {!step.done && (
              <Link to={step.to} className="button button--quiet">
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
