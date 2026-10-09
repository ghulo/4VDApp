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
    phone: user.phone,
    avatarUrl: mediaUrl(user.avatar_media_id),
    theme: user.theme,
    language: user.language,
    monthlyTarget: toMoneyOrNull(user.monthly_target),
    commissionPercent: user.commission_percent === null ? null : Number(user.commission_percent),
    createdAt: user.created_at.toISOString(),
  };
}

/** Where an uploaded image is served from, or null when there isn't one. */
export function mediaUrl(mediaId: string | null): string | null {
  return mediaId ? `/api/media/${mediaId}` : null;
}

const MEDIA_URL = /^\/api\/media\/([0-9a-f-]{36})$/i;

/** The id of an uploaded image from its URL, or null for an outside link or none. */
export function mediaIdFrom(url: string | null): string | null {
  return url?.match(MEDIA_URL)?.[1] ?? null;
}
