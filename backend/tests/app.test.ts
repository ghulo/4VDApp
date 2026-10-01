import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDatabase } from '../src/database/connection.js';

// These tests never reach the database; the client only connects on first query.
const testConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/unused_test',
  JWT_SECRET: 'test-secret-that-is-long-enough',
});
const db = createDatabase(testConfig.databaseUrl);
const app = createApp(testConfig, db);

afterAll(() => db.destroy());

describe('GET /health', () => {
  it('should report the API as healthy', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.error).toBeNull();
  });
});

describe('unknown routes', () => {
  it('should return 404 in the standard error format', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      data: null,
      error: 'NOT_FOUND',
    });
  });
});

describe('loadConfig', () => {
  it('should throw a readable error when required variables are missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('should split CORS origins into a list', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://x',
      JWT_SECRET: 'test-secret-that-is-long-enough',
      CORS_ORIGINS: 'http://a.com, http://b.com,',
    });

    expect(config.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
  });
});
