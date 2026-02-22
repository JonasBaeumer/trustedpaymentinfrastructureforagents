import { prisma } from "../lib/db.js";
import type { UserRef } from "../schemas/intents.js";

export async function resolveUserRef(userRef: UserRef): Promise<string> {
  if (userRef.type === "telegram") {
    let user = await prisma.user.findUnique({
      where: { telegramUserId: userRef.telegram_user_id },
    });
    if (!user) {
      user = await prisma.user.create({
        data: { telegramUserId: userRef.telegram_user_id },
      });
    }
    return user.id;
  }
  // internal: user_id must exist
  const user = await prisma.user.findUnique({
    where: { id: userRef.user_id },
  });
  if (!user) throw new Error("User not found: " + userRef.user_id);
  return user.id;
}
