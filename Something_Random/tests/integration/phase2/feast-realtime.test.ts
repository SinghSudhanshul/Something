import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startContainers, stopContainers } from '../../setup/testcontainers.js';
import Redis from 'ioredis';

describe('Feast Realtime Redis Integration', () => {
  let redisUrl: string;
  
  beforeAll(async () => {
    const urls = await startContainers();
    redisUrl = urls.REDIS_URL;
  });

  afterAll(async () => {
    await stopContainers();
  });

  it('publishes and subscribes successfully', async () => {
    const pub = new Redis(redisUrl);
    const sub = new Redis(redisUrl);
    
    const promise = new Promise<string>((resolve) => {
      sub.on('message', (channel, message) => {
        if (channel === 'feast:test') resolve(message);
      });
    });

    await sub.subscribe('feast:test');
    await pub.publish('feast:test', 'hello');

    const msg = await promise;
    expect(msg).toBe('hello');
    
    await pub.quit();
    await sub.quit();
  });
});
