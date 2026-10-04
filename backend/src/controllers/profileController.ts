import type { Request, Response } from 'express';
import type { BusinessService } from '../services/BusinessService.js';
import type { MediaService } from '../services/MediaService.js';
import type { ProfileService } from '../services/ProfileService.js';
import { ValidationError } from '../errors/httpErrors.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { businessSchema, mediaParamsSchema, profileSchema } from '../validators/authValidators.js';
import { parseInput } from '../validators/validate.js';

/** The picture sent as the request body (express.raw has already read it). */
export function uploadedImage(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new ValidationError('Send the picture itself, with a Content-Type like image/png');
  }
  return req.body;
}

export function createProfileController(profileService: ProfileService, businessService: BusinessService) {
  return {
    async update(req: Request, res: Response): Promise<void> {
      const changes = parseInput(profileSchema, req.body);
      sendSuccess(res, await profileService.update(req.user!.id, changes), { message: 'Profile saved' });
    },

    async setAvatar(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await profileService.setAvatar(req.user!.id, uploadedImage(req)), { message: 'Photo saved' });
    },

    async removeAvatar(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await profileService.removeAvatar(req.user!.id), { message: 'Photo removed' });
    },

    async getBusiness(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await businessService.get(req.user!.id));
    },

    async updateBusiness(req: Request, res: Response): Promise<void> {
      const changes = parseInput(businessSchema, req.body);
      sendSuccess(res, await businessService.update(req.user!.id, changes), { message: 'Shop details saved' });
    },

    async setLogo(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await businessService.setLogo(req.user!.id, uploadedImage(req)), { message: 'Logo saved' });
    },

    async removeLogo(req: Request, res: Response): Promise<void> {
      sendSuccess(res, await businessService.removeLogo(req.user!.id), { message: 'Logo removed' });
    },
  };
}

export function createMediaController(mediaService: MediaService) {
  return {
    async show(req: Request, res: Response): Promise<void> {
      const { id } = parseInput(mediaParamsSchema, req.params);
      const media = await mediaService.read(id);
      // A new picture always gets a new id, so the old one can be cached forever.
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      // The dashboard and the app are on other addresses; let their <img> tags load it.
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.type(media.mime).send(media.bytes);
    },
  };
}
