import { Redis } from 'ioredis';

let _redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    _redis = new Redis(url, { maxRetriesPerRequest: null });
  }
  return _redis;
}

export function createRedisConnection(): Redis {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  return new Redis(url, { maxRetriesPerRequest: null });
}
