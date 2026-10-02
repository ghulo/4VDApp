import { createContext, useContext } from 'react';
import type { User } from '../services/types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: User };

export interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Replace the signed-in person's details after they edit their profile. */
  updateUser: (user: User) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** For screens that only render when signed in. */
export function useCurrentUser(): User {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useCurrentUser used while signed out');
  return state.user;
}

/** Employees and admins can record sales; family members only browse. */
export function canRecordSales(user: User): boolean {
  return user.role === 'admin' || user.role === 'employee';
}
