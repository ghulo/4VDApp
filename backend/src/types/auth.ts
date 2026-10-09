import type { UserRole } from '../database/types.js';
import type { Language } from '../i18n/language.js';

/** Who is making the request, taken from a valid access token. */
export interface RequestIdentity {
  userId: number;
  email: string;
  role: UserRole;
  /** The device session this token belongs to, so "log out other devices" can spare it. */
  sessionId?: string;
}

/** The user as the API exposes it. Never includes the password hash. */
export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  phone: string | null;
  /** Path to the photo, e.g. /api/media/<id>; null shows initials. */
  avatarUrl: string | null;
  theme: 'light' | 'dark' | 'system';
  /** The language they read 4VD in: 'en' or 'sq' (Albanian). */
  language: Language;
  /** Gets the Monday report email (admins only receive it). */
  /** Euros of sales (after refunds) the owner hopes for each month; null when not set. */
  monthlyTarget: number | null;
  /** Share of their sales (after refunds) they earn; null when not set. */
  commissionPercent: number | null;
  createdAt: string;
}
