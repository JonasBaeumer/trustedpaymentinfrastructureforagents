// Unit test: verify prisma client module exports correctly (no DB connection needed)
describe('DB client module', () => {
  it('exports a prisma client instance', () => {
    // We don't connect to DB in unit tests — just verify the module loads
    jest.mock('@prisma/client', () => {
      return {
        PrismaClient: jest.fn().mockImplementation(() => ({
          $connect: jest.fn(),
          $disconnect: jest.fn(),
        })),
      };
    });
    const { prisma } = require('@/db/client');
    expect(prisma).toBeDefined();
  });
});
