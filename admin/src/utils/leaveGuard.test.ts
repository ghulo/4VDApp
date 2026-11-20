import { describe, expect, it } from 'vitest';
import { type Guard, holdsBack } from './leaveGuard';

const page = (active: boolean): Guard => ({ kind: 'page', active: () => active });
const sheet = (active: boolean): Guard => ({ kind: 'sheet', active: () => active });

describe('holdsBack', () => {
  it('lets everything through when nothing typed is at stake', () => {
    expect(holdsBack([], { currentPath: '/bills/new', nextPath: '/', action: 'PUSH' })).toBe(false);
    expect(holdsBack([page(false), sheet(false)], { currentPath: '/bills/new', nextPath: '/', action: 'POP' })).toBe(false);
  });

  it('holds a long form on its page: menu links and Back, but not a tab or filter in the address', () => {
    expect(holdsBack([page(true)], { currentPath: '/bills/new', nextPath: '/sales', action: 'PUSH' })).toBe(true);
    expect(holdsBack([page(true)], { currentPath: '/bills/new', nextPath: '/sales', action: 'POP' })).toBe(true);
    expect(holdsBack([page(true)], { currentPath: '/prices', nextPath: '/prices', action: 'REPLACE' })).toBe(false);
  });

  it('holds a filled card only against Back, so its own Save (which drops ?new=1) closes it', () => {
    expect(holdsBack([sheet(true)], { currentPath: '/expenses', nextPath: '/expenses', action: 'POP' })).toBe(true);
    expect(holdsBack([sheet(true)], { currentPath: '/expenses', nextPath: '/', action: 'POP' })).toBe(true);
    expect(holdsBack([sheet(true)], { currentPath: '/expenses', nextPath: '/expenses', action: 'PUSH' })).toBe(false);
  });

  it('never stands between a lapsed session and the sign-in page', () => {
    expect(holdsBack([page(true), sheet(true)], { currentPath: '/bills/new', nextPath: '/login', action: 'REPLACE' })).toBe(false);
    expect(holdsBack([page(true), sheet(true)], { currentPath: '/bills/new', nextPath: '/login', action: 'POP' })).toBe(false);
  });

  it('reads each guard at the moment of the move', () => {
    let typed = false;
    const guard: Guard = { kind: 'page', active: () => typed };
    expect(holdsBack([guard], { currentPath: '/orders/new', nextPath: '/', action: 'PUSH' })).toBe(false);
    typed = true;
    expect(holdsBack([guard], { currentPath: '/orders/new', nextPath: '/', action: 'PUSH' })).toBe(true);
  });
});
