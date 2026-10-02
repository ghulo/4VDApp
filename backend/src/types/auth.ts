import type { UserRole } from '../database/types.js';

/** Who is making the request, taken from a valid access token. */
export interface RequestIdentity {
  userId: number;
  email: string;
  role: UserRole;
}

/** The user as the API exposes it. Never includes the password hash. */
export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  /** Euros of sales (after refunds) the owner hopes for each month; null when not set. */
  monthlyTarget: number | null;
  /** Share of their sales (after refunds) they earn; null when not set. */
  commissionPercent: number | null;
  createdAt: string;
}
