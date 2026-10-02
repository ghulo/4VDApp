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
export function setupSteps(data: SetupData): SetupStep[] {
  return [
    {
      id: 'details',
      title: 'Add your shop details',
      why: 'Your address and phone go on invites and emails.',
      to: '/settings',
      action: 'Add details',
      done: Boolean(data.business?.address || data.business?.phone),
    },
    {
      id: 'logo',
      title: 'Add your logo',
      why: 'It shows on invites and the team app.',
      to: '/settings',
      action: 'Add logo',
      done: Boolean(data.business?.logoUrl),
    },
    {
      id: 'product',
      title: 'Add your first product',
      why: 'Stock, sales and reports all start here.',
      to: '/products/new',
      action: 'Add a product',
      done: data.productCount > 0,
    },
    {
      id: 'invite',
      title: 'Invite your team',
      why: 'Staff record sales and count stock from their phones.',
      to: '/people',
      action: 'Invite someone',
      done: data.peopleCount > 1 || data.openInvites > 0,
    },
    {
      id: 'alerts',
      title: 'Turn on alerts',
      why: 'Hear about low stock and requests straight away.',
      to: '/profile',
      action: 'Turn on alerts',
      done: data.alertDevices > 0,
    },
  ];
}
