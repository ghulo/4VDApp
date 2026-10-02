import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { accountApi } from '../services/api';

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(element: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let scriptLoading: Promise<void> | null = null;

/** Google's sign-in script, loaded once and only on pages that show the button. */
function loadGoogleScript(): Promise<void> {
  scriptLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google sign-in could not load'));
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/**
 * "Continue with Google". Renders nothing until Google sign-in is set up on
 * the server (GOOGLE_CLIENT_ID), so the page works the same without it.
 */
export function GoogleButton({ onCredential, label = 'continue_with' }: { onCredential: (credential: string) => void; label?: 'signin_with' | 'continue_with' }) {
  const status = useQuery({ queryKey: ['auth', 'google'], queryFn: accountApi.googleStatus, staleTime: Infinity });
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const [failed, setFailed] = useState(false);
  // Keep the latest handler without re-rendering Google's button.
  useEffect(() => {
    callback.current = onCredential;
  }, [onCredential]);

  const clientId = status.data?.enabled ? status.data.clientId : null;
  useEffect(() => {
    if (!clientId || !container.current) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !window.google || !container.current) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: (response) => callback.current(response.credential) });
        window.google.accounts.id.renderButton(container.current, {
          theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'rectangular',
          text: label,
          width: container.current.offsetWidth || 320,
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clientId, label]);

  if (!clientId) return null;
  return (
    <div className="google-sign-in">
      <p className="google-sign-in__divider">or</p>
      <div ref={container} className="google-sign-in__button" />
      {failed && <p className="field-hint">Google sign-in couldn't load. Use your email and password.</p>}
    </div>
  );
}
