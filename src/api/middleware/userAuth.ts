import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '@/db/client';

export async function userAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized: missing or invalid Authorization header' });
  }
  const rawKey = authHeader.slice(7);

  // Find user by scanning apiKeyHash — for small user counts this is acceptable.
  // For scale, store a key prefix/hint for lookup.
  const users = await prisma.user.findMany({ where: { apiKeyHash: { not: null } } });
  for (const user of users) {
    if (user.apiKeyHash && await bcrypt.compare(rawKey, user.apiKeyHash)) {
      (request as any).user = user;
      return;
    }
  }

  return reply.status(401).send({ error: 'Unauthorized: invalid API key' });
}
