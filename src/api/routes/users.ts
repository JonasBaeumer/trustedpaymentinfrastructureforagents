import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { userAuthMiddleware } from '@/api/middleware/userAuth';

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/users/me', {
    preHandler: userAuthMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    return reply.send({
      id: user.id,
      email: user.email,
      mainBalance: user.mainBalance,
      maxBudgetPerIntent: user.maxBudgetPerIntent,
      createdAt: user.createdAt,
    });
  });
}
