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
  createdAt: string;
}
