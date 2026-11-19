import express, { type Request, type Response, Router } from 'express';
import { sendSuccess } from '../utils/apiResponse.js';
import { addBusinessSchema } from '../validators/authValidators.js';
import { parseInput } from '../validators/validate.js';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMITS } from '../constants/rateLimits.js';
import { systemRoute } from '../database/businessContext.js';
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

/**
 * A business's look by its short name, for its own sign-in and portal links
 * (4vd.app/login?b=<short>): name, logo and colours only. Public, so it is
 * rate-limited and runs as the system (no business is signed in yet).
 */
export function createBrandRoutes({ businessService }: Container): Router {
  const router = Router();
  const limit = rateLimit({ windowMs: RATE_LIMIT_WINDOW_MS, limit: RATE_LIMITS.PUBLIC, standardHeaders: 'draft-8', legacyHeaders: false });
  router.get('/:shortName', limit, systemRoute, async (req, res) => {
    const { shortName } = parseInput(brandParamsSchema, req.params);
    sendSuccess(res, await businessService.publicBrand(shortName));
  });
  return router;
}

const brandParamsSchema = z.object({ shortName: z.string().regex(/^[a-z0-9-]{3,30}$/) });

/** Photos and logos, public by their unguessable id so <img> tags can show them. */
export function createMediaRoutes({ mediaService }: Container): Router {
  const controller = createMediaController(mediaService);
  const router = Router();
  router.get('/:id', controller.show);
  return router;
}

export { readImage };
