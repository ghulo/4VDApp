import type { ErrorEvent } from '@sentry/react'
import { describe, expect, it } from 'vitest'
import { scrubBreadcrumb, scrubEvent } from './errorTracking'

describe('dashboard error tracking keeps personal data out', () => {
  it('strips the user, extras, query strings and emails', () => {
    const event = {
      user: { email: 'a@b.co' },
      extra: { note: 'x' },
      request: { url: 'https://4vd.app/customers?search=Ana', headers: { Referer: 'r' } },
      exception: { values: [{ value: 'Cannot read a@b.co' }] },
      breadcrumbs: [
        { category: 'console', message: 'a@b.co' },
        { category: 'navigation', data: { from: '/a?x=1', to: '/b?token=t' } },
        { category: 'fetch', data: { url: 'https://api.4vd.app/api/customers?search=Ana', method: 'GET' } },
      ],
    } as unknown as ErrorEvent
    const out = scrubEvent(event)
    expect(out.user).toBeUndefined()
    expect(out.extra).toBeUndefined()
    expect(out.request).toEqual({ url: 'https://4vd.app/customers' })
    expect(out.exception?.values?.[0]?.value).toBe('Cannot read [email]')
    expect(out.breadcrumbs?.map((b) => b.data)).toEqual([
      { from: '/a', to: '/b' },
      { url: 'https://api.4vd.app/api/customers', method: 'GET' },
    ])
  })

  it('drops typed text', () => {
    expect(scrubBreadcrumb({ category: 'ui.input', message: 'input' })).toBeNull()
  })
})
