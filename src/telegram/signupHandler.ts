import type { Update } from 'grammy/types';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/db/client';
import { getTelegramBot } from './telegramClient';
import { getSignupSession, setSignupSession, clearSignupSession } from './sessionStore';

export async function handleTelegramMessage(update: Update): Promise<void> {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const text = (message.text ?? '').trim();
  const bot = getTelegramBot();

  // Handle /start <code> command
  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const code = parts[1]?.toUpperCase();

    if (!code) {
      await bot.api.sendMessage(
        chatId,
        'Welcome! To sign up, ask your OpenClaw assistant for a pairing code, then send: /start <code>',
      );
      return;
    }

    const pairingCode = await prisma.pairingCode.findUnique({ where: { code } });

    if (!pairingCode) {
      await bot.api.sendMessage(chatId, '⚠️ Code not found. Please check the code and try again.');
      return;
    }

    if (pairingCode.expiresAt < new Date()) {
      await bot.api.sendMessage(
        chatId,
        '⚠️ This code has expired. Please ask your OpenClaw assistant for a new code.',
      );
      return;
    }

    if (pairingCode.claimedByUserId) {
      await bot.api.sendMessage(chatId, '⚠️ This code has already been used.');
      return;
    }

    await setSignupSession(chatId, {
      step: 'awaiting_email',
      agentId: pairingCode.agentId,
      pairingCode: code,
    });

    await bot.api.sendMessage(chatId, '👋 Welcome! What email address should we use for your account?');
    return;
  }

  // Handle free-text (email step)
  const session = await getSignupSession(chatId);
  if (!session) {
    await bot.api.sendMessage(chatId, 'Send /start <code> to begin signup.');
    return;
  }

  const email = text.toLowerCase();

  if (!isValidEmail(email)) {
    await bot.api.sendMessage(chatId, "⚠️ That doesn't look like a valid email. Please try again.");
    return;
  }

  try {
    const rawKey = crypto.randomBytes(32).toString('hex');
    const apiKeyHash = await bcrypt.hash(rawKey, 10);

    const user = await prisma.user.create({
      data: {
        email,
        telegramChatId: chatId.toString(),
        agentId: session.agentId,
        mainBalance: 1_000_000, // 10 000 EUR in cents
        maxBudgetPerIntent: 50000,
        apiKeyHash,
        apiKeyPrefix: rawKey.slice(0, 16),
      },
    });

    await prisma.pairingCode.update({
      where: { code: session.pairingCode },
      data: { claimedByUserId: user.id },
    });

    await clearSignupSession(chatId);

    await bot.api.sendMessage(
      chatId,
      `Account created! Your OpenClaw is now linked.\n\nYour API key (save it — it won't be shown again):\n\n${rawKey}\n\nYou'll receive payment approval requests here.`,
    );
  } catch (err: any) {
    if (err.code === 'P2002') {
      // Unique constraint — email already taken
      await bot.api.sendMessage(
        chatId,
        '⚠️ An account with that email already exists. Please use a different email.',
      );
    } else {
      throw err;
    }
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
