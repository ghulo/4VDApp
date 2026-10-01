import type { Request, Response } from 'express';
import { sendSuccess } from '../utils/apiResponse.js';

export function getHealth(_req: Request, res: Response): void {
  sendSuccess(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}
