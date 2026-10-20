import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { accountApi } from '../services/api';
import { activeCatalogue, useLanguage, useT } from '../i18n/useT';

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
    script.onerror = () => reject(new Error(activeCatalogue().google.couldNotLoad));
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
  const t = useT();
  const { language } = useLanguage();
  // Keep the latest handler without re-rendering Google's button.
  useEffect(() => {
    callback.current = onCredential;
  }, [onCredential]);

  const clientId = status.data?.enabled ? status.data.clientId : null;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const target = container.current;
    if (!clientId || !target) return;
    let cancelled = false;
    // Google draws its own button in a frame we can't style, so a 4VD key is
    // shown and Google's real button lies invisibly on top of it, stretched
    // to the key's size (Google caps it at 400 × 40px), and takes the click.
    const fit = () => {
      const frame = target.firstElementChild as HTMLElement | null;
      if (!frame) return;
      frame.style.transform = `scale(${target.offsetWidth / GOOGLE_WIDTH}, ${target.offsetHeight / GOOGLE_HEIGHT})`;
    };
    const resize = new ResizeObserver(fit);
    loadGoogleScript()
      .then(() => {
        if (cancelled || !window.google) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: (response) => callback.current(response.credential) });
        window.google.accounts.id.renderButton(target, {
          type: 'standard',
          size: 'large',
          text: label,
          locale: language,
          width: GOOGLE_WIDTH,
        });
        fit();
        resize.observe(target);
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      resize.disconnect();
    };
  }, [clientId, label, language]);

  if (!clientId) return null;
  return (
    <div className="google-sign-in">
      <p className="google-sign-in__divider">{t.common.or}</p>
      <div className="google-sign-in__key" aria-busy={!ready && !failed} data-disabled={failed || undefined}>
        <span className="button button--secondary button--wide google-sign-in__face" aria-hidden="true">
          <GoogleMark />
          {label === 'signin_with' ? t.google.signIn : t.google.continueWith}
        </span>
        <div ref={container} className="google-sign-in__button" />
      </div>
      {failed && <p className="field-hint">{t.google.couldNotLoadHint}</p>}
    </div>
  );
}

const GOOGLE_WIDTH = 400;
const GOOGLE_HEIGHT = 40;

/** Google's four-colour "G", as its sign-in guidelines ask for. */
function GoogleMark() {
  return (
    <svg className="google-sign-in__mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
