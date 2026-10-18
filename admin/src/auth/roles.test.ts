import { describe, expect, it } from 'vitest';
import { assignableRoles, canHandOut, canManage, canOversee, canSell, canUseDashboard, counterOnly } from './roles';

describe('roles', () => {
  it('should let the developer, admins and the owner into the dashboard, but only managers change things', () => {
    expect(['developer', 'admin', 'owner'].every((role) => canOversee(role as never))).toBe(true);
    expect(canOversee('employee')).toBe(false);
    expect(canManage('owner')).toBe(false);
    expect(canManage('admin')).toBe(true);
  });

  it('should let employees in for the Counter only, and keep family out', () => {
    expect(canUseDashboard('employee')).toBe(true);
    expect(counterOnly('employee')).toBe(true);
    expect(counterOnly('owner')).toBe(false);
    expect(canSell('accountant')).toBe(false);
    expect(canUseDashboard('family')).toBe(false);
  });

  it('should leave the top roles to the developer', () => {
    expect(assignableRoles('developer')).toEqual(['developer', 'admin', 'owner', 'accountant', 'employee', 'family']);
    expect(assignableRoles('admin')).toEqual(['employee', 'family']);
    expect(assignableRoles('owner')).toEqual([]);
    expect(canHandOut('admin', 'owner')).toBe(false);
    expect(canHandOut('developer', 'owner')).toBe(true);
    expect(canHandOut('admin', 'accountant')).toBe(false);
  });
});
