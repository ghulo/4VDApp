import express, { Router } from 'express';
import type { Container } from '../container.js';
import { createMediaController, createProfileController } from '../controllers/profileController.js';

/** Pictures arrive as the raw request body; anything over 5 MB is refused with 413. */
const readImage = express.raw({ type: 'image/*', limit: '5mb' });

export function createBusinessRoutes({ profileService, businessService, guards }: Container): Router {
  const controller = createProfileController(profileService, businessService);
  const router = Router();

  router.get('/', guards.authenticated, controller.getBusiness);
  router.put('/', ...guards.admin, controller.updateBusiness);
  router.put('/logo', ...guards.admin, readImage, controller.setLogo);
  router.delete('/logo', ...guards.admin, controller.removeLogo);

  return router;
}

/** Photos and logos, public by their unguessable id so <img> tags can show them. */
export function createMediaRoutes({ mediaService }: Container): Router {
  const controller = createMediaController(mediaService);
  const router = Router();
  router.get('/:id', controller.show);
  return router;
}

export { readImage };
