import { describe, expect, it } from 'vitest';
import { bcryptRounds } from '../src/utils/password.js';

describe('password hash cost', () => {
  it('uses the full cost on the live server, even if the test runner flag leaked into it', () => {
    expect(bcryptRounds({ NODE_ENV: 'production' })).toBe(12);
    expect(bcryptRounds({ NODE_ENV: 'production', VITEST: 'true' })).toBe(12);
    expect(bcryptRounds({ NODE_ENV: 'development' })).toBe(12);
  });

  it('uses the cheapest cost only under the test runner', () => {
    expect(bcryptRounds({ NODE_ENV: 'test', VITEST: 'true' })).toBe(4);
  });
});
