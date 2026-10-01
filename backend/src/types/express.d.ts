import type { PublicUser, RequestIdentity } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by identifyRequester when a valid access token is present. */
      identity?: RequestIdentity;
      /** Set by requireAuth after confirming the account is still active. */
      user?: PublicUser;
    }
  }
}

export {};
