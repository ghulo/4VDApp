import { Router } from 'express';
import { getDatabaseHealth, getHealth } from '../controllers/healthController.js';
import type { DatabaseClient } from '../database/connection.js';

export function createHealthRoutes(db: DatabaseClient): Router {
  const routes = Router();
  routes.get('/', getHealth);
  routes.get('/db', getDatabaseHealth(db));
  return routes;
}
