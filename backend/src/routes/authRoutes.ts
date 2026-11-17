import { Router } from 'express';
import type { Container } from '../container.js';
import { createAccountController, createSignupController } from '../controllers/accountController.js';
import { createAuthController } from '../controllers/authController.js';
import { createGoogleController } from '../controllers/googleController.js';
import { createInviteController } from '../controllers/inviteController.js';
import { systemRoute } from '../database/businessContext.js';
import { createLoginRateLimiter } from '../middlewares/rateLimiter.js';
import { createPasskeyController } from '../controllers/passkeyController.js';

export function createAuthRoutes({
  authService,
  twoStepService,
  passkeyService,
  inviteService,
  accountService,
  googleAuthService,
  signupService,
  guards,
  config,
}: Container): Router {
  const signup = createSignupController(signupService);
  const google = createGoogleController(googleAuthService, config.refreshTokenTtlDays);
  const controller = createAuthController(authService, twoStepService, config.refreshTokenTtlDays);
  const invites = createInviteController(inviteService, config.refreshTokenTtlDays);
  const account = createAccountController(accountService);
  const passkeys = createPasskeyController(passkeyService, config.refreshTokenTtlDays);
  const router = Router();
  // Public links from emails share the failed-login limit, which slows guessing.
  const linkLimiter = createLoginRateLimiter();
  // Signing in comes before anyone's business is known; each route names it once it knows the person.
  router.use(systemRoute);

  router.post('/login', createLoginRateLimiter(), controller.login);
  // The code step after the password; shares the failed-login limit, which slows guessing.
  router.post('/two-step', createLoginRateLimiter(), controller.twoStep);
  // Passkeys: sign in with the device's fingerprint, face or PIN, or use one instead of the code.
  // The prompts always succeed, so only the general per-address limit applies to them; failed answers share the failed-login limit.
  router.post('/passkey/options', passkeys.signInOptions);
  router.post('/passkey', createLoginRateLimiter(), passkeys.signIn);
  router.post('/two-step/passkey/options', passkeys.twoStepOptions);
  router.post('/two-step/passkey', createLoginRateLimiter(), passkeys.twoStep);
  router.post('/refresh', controller.refresh);
  router.post('/logout', guards.authenticated, controller.logout);
  router.get('/me', guards.authenticated, controller.me);
  router.get('/invites/:token', linkLimiter, invites.preview);
  router.post('/invites/:token/accept', linkLimiter, invites.accept);
  router.get('/google', google.status);
  router.post('/google', linkLimiter, google.signIn);
  router.post('/invites/:token/google', linkLimiter, google.acceptInvite);
  router.post('/signup', linkLimiter, signup.signup);
  router.post('/forgot-password', linkLimiter, account.forgotPassword);
  router.post('/reset-password', linkLimiter, account.resetPassword);
  router.post('/resend-verification', linkLimiter, account.resendVerification);
  router.post('/verify-email', linkLimiter, account.verifyEmail);
  router.post('/confirm-email-change', linkLimiter, account.confirmEmailChange);

  return router;
}
