import { Router } from 'express';
import type { Container } from '../container.js';
import { createAccountController } from '../controllers/accountController.js';
import { createProfileController } from '../controllers/profileController.js';
import { createSessionController } from '../controllers/sessionController.js';
import { createGoogleController } from '../controllers/googleController.js';
import { createCounterPinController } from '../controllers/counterPinController.js';
import { readImage } from './profileRoutes.js';

/** The signed-in person's own account. */
export function createMeRoutes({
  accountService,
  profileService,
  businessService,
  sessionService,
  googleAuthService,
  counterPinService,
  guards,
}: Container): Router {
  const pins = createCounterPinController(counterPinService);
  const google = createGoogleController(googleAuthService);
  const sessions = createSessionController(sessionService);
  const account = createAccountController(accountService);
  const profile = createProfileController(profileService, businessService);
  const router = Router();

  router.use(guards.authenticated);
  router.post('/password', account.changePassword);
  router.post('/email', account.changeEmail);
  router.put('/profile', profile.update);
  router.put('/avatar', readImage, profile.setAvatar);
  router.delete('/avatar', profile.removeAvatar);
  router.get('/security', google.security);
  router.delete('/google', google.unlink);
  router.put('/pin', pins.setPin);
  router.get('/sessions', sessions.list);
  router.post('/sessions/log-out-others', sessions.endOthers);
  router.delete('/sessions/:sessionId', sessions.end);

  return router;
}
