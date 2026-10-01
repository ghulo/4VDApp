import type { RequestHandler } from 'express';
import type { AppConfig } from './config/env.js';
import type { DatabaseClient } from './database/connection.js';
import { requireAuth, requireRole } from './middlewares/authenticate.js';
import { RefreshTokenRepository } from './repositories/RefreshTokenRepository.js';
import { UserRepository } from './repositories/UserRepository.js';
import { AuthService } from './services/AuthService.js';

/**
 * The one place where repositories and services are created and wired
 * together (constructor injection, see docs/ARCHITECTURE.md). Tests can build
 * their own container with fakes instead.
 */
export function createContainer(config: AppConfig, db: DatabaseClient) {
  const userRepository = new UserRepository(db);
  const refreshTokenRepository = new RefreshTokenRepository(db);

  const authService = new AuthService(userRepository, refreshTokenRepository, config);

  const authenticated = requireAuth(userRepository);
  const guards = {
    authenticated,
    // Arrays so routes can spread them: router.post('/', ...guards.admin, handler)
    admin: [authenticated, requireRole('admin')] as RequestHandler[],
    staff: [authenticated, requireRole('admin', 'employee')] as RequestHandler[],
  };

  return {
    config,
    db,
    userRepository,
    authService,
    guards,
  };
}

export type Container = ReturnType<typeof createContainer>;
