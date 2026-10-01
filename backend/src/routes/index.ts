import { Router } from 'express';

/**
 * Root router for everything under /api. Feature routers (products, auth,
 * inventory, sales, pricing, users) get mounted here as they are built.
 */
export const apiRoutes = Router();
