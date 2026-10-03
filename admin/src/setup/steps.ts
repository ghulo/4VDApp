import { type Catalogue, en } from '../i18n/en';

export interface SetupData {
  business: { address: string | null; phone: string | null; logoUrl: string | null } | null;
  productCount: number;
  /** Everyone with an account, including the owner. */
  peopleCount: number;
  openInvites: number;
  /** Phones and computers getting this person's alerts. */
  alertDevices: number;
}

export interface SetupStep {
  id: 'details' | 'logo' | 'product' | 'invite' | 'alerts';
  title: string;
  why: string;
  to: string;
  action: string;
  done: boolean;
}

/** What a new shop needs before 4VD is really useful, each ticked off from what already exists. */
export function setupSteps(data: SetupData, t: Catalogue = en): SetupStep[] {
  return [
    {
      id: 'details',
      ...t.setup.steps.details,
      to: '/settings',
      done: Boolean(data.business?.address || data.business?.phone),
    },
    {
      id: 'logo',
      ...t.setup.steps.logo,
      to: '/settings',
      done: Boolean(data.business?.logoUrl),
    },
    {
      id: 'product',
      ...t.setup.steps.product,
      to: '/products/new',
      done: data.productCount > 0,
    },
    {
      id: 'invite',
      ...t.setup.steps.invite,
      to: '/people',
      done: data.peopleCount > 1 || data.openInvites > 0,
    },
    {
      id: 'alerts',
      ...t.setup.steps.alerts,
      to: '/profile',
      done: data.alertDevices > 0,
    },
  ];
}
