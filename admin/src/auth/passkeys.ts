import { browserSupportsWebAuthn, WebAuthnError } from '@simplewebauthn/browser';
import { useLocation } from 'react-router';
import { useDesktopSetup } from '../desktop/desktopSetup';
import { ApiError } from '../services/apiClient';
import { activeCatalogue } from '../i18n/useT';
import { errorMessage } from '../utils/errors';

/**
 * Passkeys (the device's fingerprint, face or PIN) are for people's own
 * accounts, not the Counter: a shared shop PC's Windows Hello checks the
 * Windows account, not who is standing there, so the Counter page and a
 * Windows app set up as the Counter offer neither adding nor signing in with
 * one (the Counter keeps its PIN takeover).
 */
export function usePasskeysHere(): boolean {
  const { pathname } = useLocation();
  const setup = useDesktopSetup();
  if (typeof window === 'undefined' || !browserSupportsWebAuthn()) return false;
  if (pathname.startsWith('/counter')) return false;
  return setup.data?.role !== 'counter';
}

/** The person closed the device prompt, or another prompt replaced it: nothing to say. */
export function passkeyCancelled(error: unknown): boolean {
  if (error instanceof WebAuthnError) return error.code === 'ERROR_CEREMONY_ABORTED' || error.name === 'NotAllowedError' || error.name === 'AbortError';
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

/** What went wrong with a passkey, in the reader's language. */
export function passkeyMessage(error: unknown): string {
  const t = activeCatalogue().passkeys;
  if (error instanceof WebAuthnError && error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return t.alreadyOnDevice;
  if (error instanceof WebAuthnError || error instanceof DOMException) return t.deviceFailed;
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK') return navigator.onLine ? activeCatalogue().auth.unreachable : activeCatalogue().auth.offline;
    if (error.code === 'PASSKEY_UNKNOWN') return t.unknown;
    if (error.code === 'PASSKEY_REFUSED') return t.refused;
    if (error.code === 'PASSKEY_FAILED') return t.failed;
    if (error.code === 'PASSKEY_NOT_SAVED') return t.notSaved;
    if (error.code === 'TOO_MANY_PASSKEYS') return t.tooMany;
    if (error.code === 'WRONG_PASSWORD') return t.wrongPassword;
    if (error.code === 'WRONG_CODE') return activeCatalogue().auth.wrongCode;
    if (error.code === 'TOO_MANY_CODES' || error.status === 429) return activeCatalogue().auth.tooManyCodes;
    if (error.code === 'TWO_STEP_EXPIRED') return activeCatalogue().auth.codeExpired;
  }
  return errorMessage(error);
}
