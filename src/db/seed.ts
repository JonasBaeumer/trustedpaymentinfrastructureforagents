import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@agentpay.dev' },
    update: {},
    create: {
      email: 'demo@agentpay.dev',
      mainBalance: 100000, // £1000.00 in pence
      maxBudgetPerIntent: 50000, // £500.00
      merchantAllowlist: [],
      mccAllowlist: [],
    },
  });

  console.log(JSON.stringify({ level: 'info', message: 'Seeded demo user', userId: user.id, email: user.email }));
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ level: 'error', message: 'Seed failed', error: String(e) }));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
