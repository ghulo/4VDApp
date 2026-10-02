import type { UserRow } from '../database/types.js';
import type { PublicUser } from '../types/auth.js';

/** pg returns DECIMAL as a string; the API promises plain numbers. */
export function toMoney(value: string | number): number {
  return Number(value);
}

export function toMoneyOrNull(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

export function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.is_active,
    monthlyTarget: toMoneyOrNull(user.monthly_target),
    commissionPercent: user.commission_percent === null ? null : Number(user.commission_percent),
    createdAt: user.created_at.toISOString(),
  };
}
