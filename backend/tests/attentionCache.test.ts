import type { NextFunction, Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { forgetOnChange, remembered } from '../src/utils/attentionCache.js';

const TTL = 30_000;

/** Runs the middleware for one request and finishes it. */
function finish(method: string, originalUrl = '/api/products'): void {
  const res = new EventEmitter();
  forgetOnChange({ method, originalUrl } as Request, res as unknown as Response, (() => undefined) as NextFunction);
  res.emit('finish');
}

describe('remembered To do lists', () => {
  it('should share one answer for 30 seconds, then work it out again', async () => {
    let runs = 0;
    const work = async () => ++runs;
    expect(await remembered('a', work, 1_000, TTL).value).toBe(1);
    expect(remembered('a', work, 20_000, TTL).cached).toBe(true);
    expect(await remembered('a', work, 31_001, TTL).value).toBe(2);
  });

  it('should keep businesses, roles and languages apart', async () => {
    let runs = 0;
    const work = async () => ++runs;
    await remembered('1|owner|en', work, 0, TTL).value;
    expect(remembered('2|owner|en', work, 0, TTL).cached).toBe(false);
    expect(remembered('1|owner|sq', work, 0, TTL).cached).toBe(false);
  });

  it('should forget after a change, not after a read', async () => {
    let runs = 0;
    const work = async () => ++runs;
    await remembered('b', work, 0, TTL).value;
    finish('GET');
    expect(remembered('b', work, 0, TTL).cached).toBe(true);
    finish('POST');
    expect(remembered('b', work, 0, TTL).cached).toBe(false);
  });

  it('should keep answers when the write is only a sign-in or the alerts device', async () => {
    let runs = 0;
    const work = async () => ++runs;
    await remembered('e', work, 0, TTL).value;
    finish('POST', '/api/notifications/push');
    finish('POST', '/api/auth/refresh');
    expect(remembered('e', work, 0, TTL).cached).toBe(true);
    finish('POST', '/api/notifications/push-test');
    expect(remembered('e', work, 0, TTL).cached).toBe(false);
  });

  it('should never share a failed answer', async () => {
    const failing = remembered('c', () => Promise.reject(new Error('down')), 0, TTL);
    await expect(failing.value).rejects.toThrow('down');
    expect(remembered('c', async () => 1, 0, TTL).cached).toBe(false);
  });

  it('should remember nothing when the time is zero (tests)', () => {
    remembered('d', async () => 1, 0, 0);
    expect(remembered('d', async () => 2, 0, 0).cached).toBe(false);
  });
});
