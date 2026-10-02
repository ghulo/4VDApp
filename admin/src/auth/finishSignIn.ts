import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { LoginResult } from '../services/types';
import { useAuth } from './useAuth';

/** Where staff use 4VD; the dashboard is only for admins. */
export const TEAM_APP_URL = import.meta.env.VITE_TEAM_APP_URL ?? 'http://localhost:8081';

/** After an invite or Google sign-in: admins land on the dashboard, everyone else is sent to the app. */
export function useFinishSignIn() {
  const { adoptSession } = useAuth();
  const navigate = useNavigate();
  const [sentToApp, setSentToApp] = useState(false);
  const finish = async (result: LoginResult) => {
    if ((await adoptSession(result)) === 'signedIn') navigate('/', { replace: true });
    else setSentToApp(true);
  };
  return { finish, sentToApp };
}
