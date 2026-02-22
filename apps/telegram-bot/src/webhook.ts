import http from "node:http";
import { config } from "./config.js";
import * as bot from "./bot.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const SECRET_PATH = process.env.WEBHOOK_SECRET_PATH || `/webhook/${config.BOT_TOKEN.slice(-8)}`;

function isBuyTrigger(text: string): boolean {
  const t = text?.trim().toLowerCase() ?? "";
  return t.startsWith("/buy ") || (t.length > 4 && (t.startsWith("buy ") || t.includes(" buy ")));
}

async function processUpdate(update: { update_id?: number; message?: { chat: { id: number }; from?: { id: number }; text?: string }; callback_query?: { id: string; from: { id: number }; message?: { chat: { id: number }; message_id: number }; data?: string } }) {
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

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== SECRET_PATH) {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const update = JSON.parse(body) as Parameters<typeof processUpdate>[0];
    await processUpdate(update);
  } catch (e) {
    console.error("Webhook error:", e);
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}, path ${SECRET_PATH}`);
  console.log(`Set Telegram webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_URL>${SECRET_PATH}`);
});
