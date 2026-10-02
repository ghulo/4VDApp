import { describe, expect, it } from 'vitest';
import { setupSteps } from './steps';

const empty = { business: null, productCount: 0, peopleCount: 1, openInvites: 0, alertDevices: 0 };

describe('setupSteps', () => {
  it('should list every step as not done for a brand-new shop', () => {
    const steps = setupSteps(empty);

    expect(steps.map((step) => step.id)).toEqual(['details', 'logo', 'product', 'invite', 'alerts']);
    expect(steps.every((step) => !step.done)).toBe(true);
  });

  it('should tick steps off from what already exists', () => {
    const steps = setupSteps({
      business: { address: null, phone: '+383 44 000 000', logoUrl: '/api/media/abc' },
      productCount: 12,
      peopleCount: 1,
      openInvites: 1,
      alertDevices: 0,
    });

    expect(Object.fromEntries(steps.map((step) => [step.id, step.done]))).toEqual({
      details: true,
      logo: true,
      product: true,
      invite: true,
      alerts: false,
    });
  });

  it('should count someone else on the team as invited, even with no open invites', () => {
    const invite = setupSteps({ ...empty, peopleCount: 3 }).find((step) => step.id === 'invite');

    expect(invite?.done).toBe(true);
  });
});
