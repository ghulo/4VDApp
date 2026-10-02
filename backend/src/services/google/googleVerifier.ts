import { OAuth2Client } from 'google-auth-library';
import { UnauthorizedError } from '../../errors/httpErrors.js';

/** What 4VD needs from a Google sign-in. */
export interface GoogleProfile {
  /** Google's permanent id for the account; emails can change, this can't. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface GoogleVerifier {
  /** Checks the ID token from the Google button. Throws UnauthorizedError when it isn't valid for 4VD. */
  verify(credential: string): Promise<GoogleProfile>;
}

/**
 * Checks Google's signature, expiry, issuer, and that the token was made for
 * 4VD's own client id (so a token for another site can't be replayed here).
 */
export class GoogleIdTokenVerifier implements GoogleVerifier {
  private readonly client: OAuth2Client;

  constructor(private readonly clientId: string) {
    this.client = new OAuth2Client(clientId);
  }

  async verify(credential: string): Promise<GoogleProfile> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience: this.clientId });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) throw new Error('Token has no account or email');
      return {
        subject: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        name: payload.name ?? payload.email,
      };
    } catch {
      throw new UnauthorizedError('Google sign-in failed. Try again.');
    }
  }
}
