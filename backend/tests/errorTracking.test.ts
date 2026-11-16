import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { maskText, scrubBreadcrumb, scrubEvent, scrubValue, stripQuery } from '../src/utils/errorTracking.js';

describe('error tracking keeps personal data out', () => {
  it('masks email addresses and drops query strings', () => {
    expect(maskText('duplicate key (email)=(ana.krasniqi@example.com)')).toBe('duplicate key (email)=([email])');
    expect(stripQuery('/api/customers?search=Ana#top')).toBe('/api/customers');
    expect(stripQuery('/api/sales')).toBe('/api/sales');
  });

  it('drops secret and personal keys at any depth', () => {
    expect(
      scrubValue({ path: '/api/x', password: 'p', nested: { customerName: 'Ana', count: 3, list: [{ token: 't' }] } }),
    ).toEqual({ path: '/api/x', password: '[removed]', nested: { customerName: '[removed]', count: 3, list: [{ token: '[removed]' }] } });
  });

  it('strips the request, the user and breadcrumbs that could hold anything', () => {
    const event = {
      user: { id: '1', email: 'a@b.co', ip_address: '1.2.3.4' },
      server_name: 'srv-1',
      request: {
        method: 'POST',
        url: 'https://api.4vd.app/api/auth/login?next=x',
        data: { email: 'a@b.co', password: 'secret' },
        cookies: { session: 's' },
        headers: { authorization: 'Bearer t', cookie: 'c' },
        query_string: 'next=x',
      },
      message: 'failed for a@b.co',
      exception: { values: [{ value: 'no user a@b.co', stacktrace: { frames: [{ vars: { pin: '1234' } }] } }] },
      extra: { email: 'a@b.co', path: '/api/x' },
      breadcrumbs: [
        { category: 'console', message: '{"email":"a@b.co"}' },
        { category: 'http', data: { url: 'https://api.resend.com/emails?key=k', method: 'POST' } },
      ],
    } as unknown as ErrorEvent;

    const out = scrubEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.request).toEqual({ method: 'POST', url: 'https://api.4vd.app/api/auth/login' });
    expect(out.message).toBe('failed for [email]');
    expect(out.exception?.values?.[0]?.value).toBe('no user [email]');
    expect(out.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
    expect(out.extra).toEqual({ email: '[removed]', path: '/api/x' });
    expect(out.breadcrumbs).toHaveLength(1);
    expect(out.breadcrumbs?.[0]?.data).toEqual({ url: 'https://api.resend.com/emails', method: 'POST' });
    expect(JSON.stringify(out)).not.toContain('a@b.co');
  });

  it('drops console breadcrumbs as they arrive', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
  });
});
