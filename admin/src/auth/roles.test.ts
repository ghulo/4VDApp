import { describe, expect, it } from 'vitest';
import { staffMayOpen, staffTabs } from '../navigation/staff';
import { assignableRoles, browseOnly, canHandOut, canManage, canOversee, canSell, canUseDashboard, counterOnly, staffLayout } from './roles';

describe('roles', () => {
  it('should let the developer, admins and the owner into the dashboard, but only managers change things', () => {
    expect(['developer', 'admin', 'owner'].every((role) => canOversee(role as never))).toBe(true);
    expect(canOversee('employee')).toBe(false);
    expect(canManage('owner')).toBe(false);
    expect(canManage('admin')).toBe(true);
  });

  it('should let employees in for the Counter only', () => {
    expect(canUseDashboard('employee')).toBe(true);
    expect(counterOnly('employee')).toBe(true);
    expect(counterOnly('owner')).toBe(false);
    expect(canSell('accountant')).toBe(false);
  });

  it('should let family in to browse products and keep favourites, and nothing else', () => {
    expect(canUseDashboard('family')).toBe(true);
    expect(browseOnly('family')).toBe(true);
    expect(staffLayout('family')).toBe(true);
    expect(staffTabs('family').map((tab) => tab.to)).toEqual(['/catalog', '/profile']);
    expect(['/catalog', '/catalog/12', '/scan/123', '/profile', '/'].every((path) => staffMayOpen(path, 'family'))).toBe(true);
    expect(['/counter', '/my-sales', '/shift', '/counts', '/sales', '/new-product'].some((path) => staffMayOpen(path, 'family'))).toBe(false);
    expect(staffMayOpen('/counter', 'employee')).toBe(true);
  });

  it('should leave the top roles to the main admin, and never hand out developer', () => {
    expect(assignableRoles('main_admin')).toEqual(['main_admin', 'admin', 'owner', 'accountant', 'employee', 'family']);
    expect(assignableRoles('developer')).toEqual(['main_admin', 'admin', 'owner', 'accountant', 'employee', 'family']);
    expect(canHandOut('main_admin', 'developer')).toBe(false);
    expect(assignableRoles('admin')).toEqual(['employee', 'family']);
    expect(assignableRoles('owner')).toEqual([]);
    expect(canHandOut('admin', 'owner')).toBe(false);
    expect(canHandOut('developer', 'owner')).toBe(true);
    expect(canHandOut('admin', 'accountant')).toBe(false);
  });
});
