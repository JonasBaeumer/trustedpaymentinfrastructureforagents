import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { telegramUserId: "demo_telegram_123" },
    update: {},
    create: {
      telegramUserId: "demo_telegram_123",
    },
  });
  console.log("Demo user:", user.id, user.telegramUserId);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
