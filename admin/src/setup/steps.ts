import type { Catalogue } from '../i18n/en';
import { activeCatalogue } from '../i18n/useT';

export interface SetupData {
  business: { address: string | null; phone: string | null; logoUrl: string | null } | null;
  productCount: number;
  /** Everyone with an account, including the owner. */
  peopleCount: number;
  openInvites: number;
  /** Phones and computers getting this person's alerts. */
  alertDevices: number;
  /** May bring data in from another program (the import power): the product step then opens Settings → Import. */
  canImport?: boolean;
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
export function setupSteps(data: SetupData, t: Catalogue = activeCatalogue()): SetupStep[] {
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
      ...(data.canImport ? { title: t.imports.bringYourData, why: t.imports.bringYourDataHint, action: t.imports.title } : t.setup.steps.product),
      to: data.canImport ? '/settings/import' : '/products/new',
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
      to: '/profile/alerts',
      done: data.alertDevices > 0,
    },
  ];
}
