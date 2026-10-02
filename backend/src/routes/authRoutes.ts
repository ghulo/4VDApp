import { Router } from 'express';
import type { Container } from '../container.js';
import { createAccountController, createSignupController } from '../controllers/accountController.js';
import { createAuthController } from '../controllers/authController.js';
import { createGoogleController } from '../controllers/googleController.js';
import { createInviteController } from '../controllers/inviteController.js';
import { createLoginRateLimiter } from '../middlewares/rateLimiter.js';

export function createAuthRoutes({
  authService,
  inviteService,
  accountService,
  googleAuthService,
  signupService,
  guards,
}: Container): Router {
  const signup = createSignupController(signupService);
  const google = createGoogleController(googleAuthService);
  const controller = createAuthController(authService);
  const invites = createInviteController(inviteService);
  const account = createAccountController(accountService);
  const router = Router();
  // Public links from emails share the failed-login limit, which slows guessing.
  const linkLimiter = createLoginRateLimiter();

  router.post('/login', createLoginRateLimiter(), controller.login);
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
