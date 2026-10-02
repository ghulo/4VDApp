import { describe, expect, it } from 'vitest';
import { assignableRoles, canHandOut, canManage, canOversee } from './roles';

describe('roles', () => {
  it('should let the developer, admins and the owner into the dashboard, but only managers change things', () => {
    expect(['developer', 'admin', 'owner'].every((role) => canOversee(role as never))).toBe(true);
    expect(canOversee('employee')).toBe(false);
    expect(canManage('owner')).toBe(false);
    expect(canManage('admin')).toBe(true);
  });

  it('should leave the top roles to the developer', () => {
    expect(assignableRoles('developer')).toEqual(['developer', 'admin', 'owner', 'employee', 'family']);
    expect(assignableRoles('admin')).toEqual(['employee', 'family']);
    expect(assignableRoles('owner')).toEqual([]);
    expect(canHandOut('admin', 'owner')).toBe(false);
    expect(canHandOut('developer', 'owner')).toBe(true);
  });
});
