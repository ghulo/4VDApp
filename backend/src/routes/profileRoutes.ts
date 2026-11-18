import express, { type Request, type Response, Router } from 'express';
import { sendSuccess } from '../utils/apiResponse.js';
import { addBusinessSchema } from '../validators/authValidators.js';
import { parseInput } from '../validators/validate.js';
import type { Container } from '../container.js';
import { createMediaController, createProfileController } from '../controllers/profileController.js';

/** Pictures arrive as the raw request body; anything over 5 MB is refused with 413. */
const readImage = express.raw({ type: 'image/*', limit: '5mb' });

/** 4VD's developer adds a business for a customer (Add business in the account menu). */
export function createBusinessesRoutes({ addBusinessService, guards }: Container): Router {
  const router = Router();
  router.post('/', ...guards.developer, async (req: Request, res: Response) => {
    const input = parseInput(addBusinessSchema, req.body);
    sendSuccess(res, await addBusinessService.add({ id: req.user!.id, name: req.user!.name, sessionId: req.identity?.sessionId ?? 'no-session' }, input), { statusCode: 201, message: 'Business added' });
  });
  return router;
}

export function createBusinessRoutes({ profileService, businessService, guards }: Container): Router {
  const controller = createProfileController(profileService, businessService);
  const router = Router();

  router.get('/', guards.authenticated, controller.getBusiness);
  router.put('/', ...guards.manage, controller.updateBusiness);
  router.put('/logo', ...guards.manage, readImage, controller.setLogo);
  router.delete('/logo', ...guards.manage, controller.removeLogo);
  router.put('/pictures/:which', ...guards.manage, readImage, controller.setPicture);
  router.delete('/pictures/:which', ...guards.manage, controller.removePicture);

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
