import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { LoginResult } from '../services/types';
import { useAuth } from './useAuth';

/** After an invite or Google sign-in: they land in 4VD (or where they were going); a role with no access gets `noAccess`. */
export function useFinishSignIn(to = '/') {
  const { adoptSession } = useAuth();
  const navigate = useNavigate();
  const [noAccess, setNoAccess] = useState(false);
  const finish = async (result: LoginResult) => {
    if ((await adoptSession(result)) === 'signedIn') navigate(to, { replace: true });
    else setNoAccess(true);
  };
  return { finish, noAccess };
}
