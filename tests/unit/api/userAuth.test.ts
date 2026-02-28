/**
 * Unit tests for the userAuth middleware.
 *
 * Uses real bcrypt hashing (not mocked) so we validate the actual compare logic.
 * Only prisma is mocked.
 */

const mockFindMany = jest.fn();
jest.mock('@/db/client', () => ({
  prisma: {
    user: { findMany: mockFindMany },
  },
}));

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { userAuthMiddleware } from '@/api/middleware/userAuth';

// Helpers to build Fastify-like request/reply doubles
function makeRequest(headers: Record<string, string | undefined> = {}): any {
  return { headers };
}

function makeReply(): any {
  const reply: any = {};
  reply.status = jest.fn().mockReturnValue(reply);
  reply.send = jest.fn().mockReturnValue(reply);
  return reply;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('userAuthMiddleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const request = makeRequest({});
    const reply = makeReply();

    await userAuthMiddleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Unauthorized') }),
    );
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('returns 401 when header is present but not "Bearer <key>" format', async () => {
    const request = makeRequest({ authorization: 'Basic abc123' });
    const reply = makeReply();

    await userAuthMiddleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Unauthorized') }),
    );
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('returns 401 when key does not match any stored hash (wrong key)', async () => {
    const hash = bcrypt.hashSync('correct-key', 10);
    mockFindMany.mockResolvedValue([
      { id: 'user-1', email: 'a@b.com', apiKeyHash: hash },
    ]);

    const request = makeRequest({ authorization: 'Bearer wrong-key' });
    const reply = makeReply();

    await userAuthMiddleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('invalid API key') }),
    );
  });

  it('returns 401 when no users have apiKeyHash set', async () => {
    mockFindMany.mockResolvedValue([]);

    const request = makeRequest({ authorization: 'Bearer some-key' });
    const reply = makeReply();

    await userAuthMiddleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('invalid API key') }),
    );
  });

  it('attaches user to request when valid key is provided', async () => {
    const rawKey = 'my-secret-api-key';
    const hash = bcrypt.hashSync(rawKey, 10);
    const user = { id: 'user-42', email: 'alice@agentpay.dev', apiKeyHash: hash };
    mockFindMany.mockResolvedValue([user]);

    const request = makeRequest({ authorization: `Bearer ${rawKey}` });
    const reply = makeReply();

    await userAuthMiddleware(request, reply);

    // Should NOT have sent a 401
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();

    // Should have attached the user
    expect(request.user).toEqual(user);
  });

  it('returns 401 if bcrypt.compare never returns true (all users checked)', async () => {
    const hash1 = bcrypt.hashSync('key-for-user-1', 10);
    const hash2 = bcrypt.hashSync('key-for-user-2', 10);
    mockFindMany.mockResolvedValue([
      { id: 'user-1', email: 'a@b.com', apiKeyHash: hash1 },
      { id: 'user-2', email: 'c@d.com', apiKeyHash: hash2 },
    ]);

    const request = makeRequest({ authorization: 'Bearer totally-different-key' });
    const reply = makeReply();

    await userAuthMiddleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('invalid API key') }),
    );
    // Verify the middleware actually checked all users
    expect(request.user).toBeUndefined();
  });

  it('matches the correct user among multiple users', async () => {
    const rawKey2 = 'key-for-second-user';
    const hash1 = bcrypt.hashSync('key-for-first-user', 10);
    const hash2 = bcrypt.hashSync(rawKey2, 10);
    const user1 = { id: 'user-1', email: 'a@b.com', apiKeyHash: hash1 };
    const user2 = { id: 'user-2', email: 'c@d.com', apiKeyHash: hash2 };
    mockFindMany.mockResolvedValue([user1, user2]);

    const request = makeRequest({ authorization: `Bearer ${rawKey2}` });
    const reply = makeReply();

    await userAuthMiddleware(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(request.user).toEqual(user2);
  });
});

describe('API key generation contract', () => {
  it('crypto.randomBytes(32).toString("hex") produces a 64-char hex string', () => {
    const rawKey = crypto.randomBytes(32).toString('hex');
    expect(rawKey).toHaveLength(64);
    expect(rawKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bcrypt hash of generated key verifies correctly with bcrypt.compare', async () => {
    const rawKey = crypto.randomBytes(32).toString('hex');
    const hash = await bcrypt.hash(rawKey, 10);

    expect(typeof hash).toBe('string');
    expect(hash).not.toBe(rawKey);
    expect(await bcrypt.compare(rawKey, hash)).toBe(true);
    expect(await bcrypt.compare('wrong-key', hash)).toBe(false);
  });
});
