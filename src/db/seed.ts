import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // TELEGRAM_TEST_CHAT_ID lets you receive real Telegram notifications without going
  // through the full OpenClaw pairing flow. Get your chat ID by messaging @userinfobot
  // on Telegram, then add it to .env. Re-running the seed updates the existing user.
  const telegramChatId = process.env.TELEGRAM_TEST_CHAT_ID || null;

  const user = await prisma.user.upsert({
    where: { email: 'demo@agentpay.dev' },
    update: {
      ...(telegramChatId ? { telegramChatId } : {}),
    },
    create: {
      email: 'demo@agentpay.dev',
      mainBalance: 100000, // £1000.00 in pence
      maxBudgetPerIntent: 50000, // £500.00
      merchantAllowlist: [],
      mccAllowlist: [],
      ...(telegramChatId ? { telegramChatId } : {}),
    },
  });

  const chatIdNote = user.telegramChatId
    ? user.telegramChatId
    : '(not set — add TELEGRAM_TEST_CHAT_ID to .env and re-run seed to receive Telegram notifications)';

  console.log(JSON.stringify({ level: 'info', message: 'Seeded demo user', userId: user.id, email: user.email, telegramChatId: chatIdNote }));
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ level: 'error', message: 'Seed failed', error: String(e) }));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
