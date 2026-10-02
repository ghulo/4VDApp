import { Router } from 'express';
import type { Container } from '../container.js';
import { createAccountController } from '../controllers/accountController.js';
import { createProfileController } from '../controllers/profileController.js';
import { readImage } from './profileRoutes.js';

/** The signed-in person's own account. */
export function createMeRoutes({ accountService, profileService, businessService, guards }: Container): Router {
  const account = createAccountController(accountService);
  const profile = createProfileController(profileService, businessService);
  const router = Router();

  router.use(guards.authenticated);
  router.post('/password', account.changePassword);
  router.post('/email', account.changeEmail);
  router.put('/profile', profile.update);
  router.put('/avatar', readImage, profile.setAvatar);
  router.delete('/avatar', profile.removeAvatar);

  return router;
}
