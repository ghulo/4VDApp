import { createContext, useContext } from 'react';
import type { LoginResult, SignInStep, User, UserRole } from '../services/types';
import type { SwitchStart } from '../offline/savedCopy';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: User };

export interface AuthContextValue {
  state: AuthState;
  /** The role the developer is previewing (Settings → Roles → View as); state.user already has it. */
  viewingAs: UserRole | null;
  /** Signs in, or hands back the code step (or the two-step setup a manager asked for). */
  login: (email: string, password: string) => Promise<SignInStep | null>;
  logout: () => Promise<void>;
  /** Keep a session from an invite or Google; 'noAccess' means their role can't use 4VD. */
  /** `place`: the Counter handing over keeps its business and the businesses for the picker. */
  adoptSession: (result: LoginResult, place?: Pick<User, 'businessId' | 'businesses'>, switched?: SwitchStart) => Promise<'signedIn' | 'noAccess'>;
  /** Replace the signed-in person's details after they edit their profile. */
  updateUser: (user: User) => void;
  /** A switch (here or in another tab) isn't settled: who is signed in is being checked, and the till doesn't sell meanwhile. */
  signInUnsure: boolean;
  /** A switch is about to be sent: nothing is saved and older checks are ignored until it settles. True when one was unsettled already. */
  beginSwitch: () => SwitchStart;
  /** The switch failed (refused, or no answer): saved again on a clear no, else 4VD is asked who is signed in. */
  switchFailed: (error: unknown, started: SwitchStart) => void;
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
