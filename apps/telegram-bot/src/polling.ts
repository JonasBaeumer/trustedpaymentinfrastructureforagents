import "dotenv/config";
import { config } from "./config.js";
import * as bot from "./bot.js";

const TELEGRAM_API = `https://api.telegram.org/bot${config.BOT_TOKEN}`;
let offset = 0;

async function getUpdates() {
  const r = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`);
  if (!r.ok) throw new Error(`getUpdates: ${r.status}`);
  const data = (await r.json()) as { ok: boolean; result?: { update_id: number; message?: object; callback_query?: object }[] };
  if (!data.ok || !data.result) return [];
  return data.result;
}

function isBuyTrigger(text: string): boolean {
  const t = text?.trim().toLowerCase() ?? "";
  return t.startsWith("/buy ") || (t.length > 4 && (t.startsWith("buy ") || t.includes(" buy ")));
}

async function processUpdate(update: { update_id: number; message?: { chat: { id: number }; from?: { id: number }; text?: string }; callback_query?: { id: string; from: { id: number }; message?: { chat: { id: number }; message_id: number }; data?: string } }) {
  offset = update.update_id + 1;

  if (update.callback_query) {
    const cq = update.callback_query;
    await bot.handleCallbackQuery(
      cq.message!.chat.id,
      cq.message!.message_id,
      cq.from.id,
      cq.id,
      cq.data!
    );
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? chatId;
  const text = msg.text.trim();

  if (text === "/start") {
    await bot.handleStart(chatId);
    return;
  }
  if (text.startsWith("/buy ")) {
    await bot.handleBuy(chatId, userId, text.slice(5));
    return;
  }
  if (isBuyTrigger(text)) {
    await bot.handleBuy(chatId, userId, text.replace(/^\/buy\s*/i, "").trim() || text);
    return;
  }
  if (text.startsWith("/quote ")) {
    const args = text.slice(7).trim().split(/\s+/);
    await bot.handleQuote(chatId, userId, args);
    return;
  }
  if (text.startsWith("/status")) {
    const arg = text.slice(7).trim();
    await bot.handleStatus(chatId, arg || undefined);
    return;
  }
}

async function run() {
  console.log("Bot polling…");
  while (true) {
    try {
      const updates = await getUpdates();
      for (const u of updates) await processUpdate(u as Parameters<typeof processUpdate>[0]);
    } catch (e) {
      console.error("Poll error:", e);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

run();
