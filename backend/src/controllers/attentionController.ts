import type { Request, Response } from 'express';
import { currentBusinessId } from '../database/businessContext.js';
import { messages } from '../i18n/messages.js';
import type { Attention, AttentionService, Timings } from '../services/AttentionService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { remembered } from '../utils/attentionCache.js';

export function createAttentionController(attentionService: AttentionService) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      const timings: Timings = [];
      const start = performance.now();
      const { role, language } = req.user!;
      // The list depends only on the business, the role and the language.
      const { value, cached } = remembered<Attention>(`${currentBusinessId()}|${role}|${language}`, () =>
        attentionService.forUser(role, messages[language], new Date(), timings),
      );
      const attention = await value;
      timings.push([cached ? 'remembered' : 'total', performance.now() - start]);
      // Which part is slow, readable in the browser's network panel.
      res.setHeader('Server-Timing', timings.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(', '));
      sendSuccess(res, attention);
    },
  };
}
