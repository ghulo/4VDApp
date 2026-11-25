import type { Request, Response } from 'express';
import { messages } from '../i18n/messages.js';
import type { AttentionService, Timings } from '../services/AttentionService.js';
import { sendSuccess } from '../utils/apiResponse.js';

export function createAttentionController(attentionService: AttentionService) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      const timings: Timings = [];
      const start = performance.now();
      const attention = await attentionService.forUser(req.user!.role, messages[req.user!.language], new Date(), timings);
      timings.push(['total', performance.now() - start]);
      // Which part is slow, readable in the browser's network panel.
      res.setHeader('Server-Timing', timings.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(', '));
      sendSuccess(res, attention);
    },
  };
}
