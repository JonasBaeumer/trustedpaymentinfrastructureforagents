import { config } from "./config.js";
import * as backend from "./backend.js";

const TELEGRAM_API = `https://api.telegram.org/bot${config.BOT_TOKEN}`;

// Per-user last intent (for /status with no arg). intentId -> telegram user id (for callback validation).
const lastIntentByChat = new Map<number, string>();
const intentCreator = new Map<string, number>();

export async function sendMessage(chatId: number, text: string, replyMarkup?: object) {
  const r = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: replyMarkup ?? undefined,
    }),
  });
  if (!r.ok) throw new Error(`sendMessage: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export async function editMessageReplyMarkup(chatId: number, messageId: number, replyMarkup: object) {
  await fetch(`${TELEGRAM_API}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup }),
  });
}

function parseBuyText(text: string): { maxBudget?: number; currency: string; clean: string } {
  const lower = text.toLowerCase();
  let maxBudget: number | undefined;
  const usdMatch = lower.match(/\$(\d+)/);
  const underMatch = lower.match(/under\s*\$?(\d+)/);
  if (usdMatch) maxBudget = parseInt(usdMatch[1], 10) * 100; // cents
  if (underMatch) maxBudget = (maxBudget ?? parseInt(underMatch[1], 10) * 100);
  const currency = lower.includes("eur") ? "EUR" : "USD";
  const clean = text.replace(/\$/g, "").replace(/\b(under|max|budget)\s*\d+/gi, "").trim();
  return { maxBudget, currency, clean: clean || text };
}

function parseQuoteArgs(args: string[]): { intentId: string; url: string; amount: number; currency: string; merchantDomain: string } | null {
  if (args.length < 5) return null;
  const [intentId, url, amountStr, currency, merchantDomain] = args;
  const amountDollars = parseFloat(amountStr);
  const amount = Math.round((Number.isNaN(amountDollars) ? 0 : amountDollars) * 100); // dollars -> cents
  if (!intentId || !url || amount <= 0 || !merchantDomain) return null;
  return { intentId, url, amount, currency: currency || "USD", merchantDomain };
}

export async function handleStart(chatId: number) {
  await sendMessage(
    chatId,
    "Hi! I'm your agent-safe shopping bot. Send <b>/buy &lt;what you want&gt;</b> (e.g. /buy Buy latest AirPods Pro under $250). Then use /quote to submit a product, and Approve/Deny to confirm."
  );
}

export async function handleBuy(chatId: number, userId: number, text: string) {
  const parsed = parseBuyText(text);
  const { intent_id, status } = await backend.createIntent(String(userId), parsed.clean, {
    max_budget: parsed.maxBudget,
    currency: parsed.currency,
    merchant_domain_allowlist: [],
  });
  lastIntentByChat.set(chatId, intent_id);
  intentCreator.set(intent_id, userId);
  await sendMessage(chatId, `Got it. Searching… (intent: <code>${intent_id}</code>)`);
}

export async function handleQuote(chatId: number, userId: number, args: string[]) {
  const parsed = parseQuoteArgs(args);
  if (!parsed) {
    await sendMessage(
      chatId,
      "Usage: /quote &lt;intentId&gt; &lt;url&gt; &lt;amount&gt; &lt;currency&gt; &lt;merchant_domain&gt;\nExample: /quote abc-123 https://apple.com/p 250 USD apple.com"
    );
    return;
  }
  const title = args[5] ?? "Product";
  await backend.postQuote(parsed.intentId, {
    title,
    url: parsed.url,
    amount: parsed.amount,
    currency: parsed.currency,
    merchant_domain: parsed.merchantDomain,
  });
  lastIntentByChat.set(chatId, parsed.intentId);
  intentCreator.set(parsed.intentId, userId);

  const intent = await backend.getIntent(parsed.intentId) as { approval?: { id: string }; intent?: { status: string }; quote?: { amount: number; merchant_domain: string } };
  const quote = (intent as { quote?: { amount: number; merchant_domain: string } }).quote;
  if (!quote) {
    await sendMessage(chatId, "Quote posted. Create approval request next.");
    return;
  }
  const { approval_id } = await backend.createApprovalRequest(
    parsed.intentId,
    quote.amount,
    "USD",
    { merchant_domain: quote.merchant_domain },
    900
  );
  const amountDisplay = (quote.amount / 100).toFixed(2);
  await sendMessage(chatId, `Approve $${amountDisplay} for ${quote.merchant_domain}? (intent: <code>${parsed.intentId}</code>)`, {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: `approve:${approval_id}:${parsed.intentId}` },
        { text: "Deny", callback_data: `deny:${approval_id}:${parsed.intentId}` },
      ],
    ],
  });
}

export async function handleStatus(chatId: number, intentIdArg: string | undefined) {
  const intentId = intentIdArg?.trim() || lastIntentByChat.get(chatId);
  if (!intentId) {
    await sendMessage(chatId, "No intent. Use /buy first, or /status &lt;intentId&gt;");
    return;
  }
  try {
    const data = await backend.getIntent(intentId) as {
      intent?: { status: string };
      quote?: { title: string; amount: number };
      result?: { status: string; summary: string };
    };
    const status = data.intent?.status ?? "?";
    const quote = data.quote;
    const result = data.result;
    let msg = `Intent <code>${intentId}</code>\nStatus: ${status}`;
    if (quote) msg += `\nQuote: ${quote.title} — $${(quote.amount / 100).toFixed(2)}`;
    if (result) msg += `\nResult: ${result.status}${result.summary ? " — " + result.summary : ""}`;
    await sendMessage(chatId, msg);
  } catch (e) {
    await sendMessage(chatId, `Error: ${(e as Error).message}`);
  }
}

export async function handleCallbackQuery(
  chatId: number,
  messageId: number,
  fromId: number,
  callbackQueryId: string,
  data: string
) {
  const [action, approvalId, intentId] = data.split(":");
  if (!approvalId || !intentId) {
    await answerCallbackQuery(callbackQueryId, "Invalid callback");
    return;
  }
  const creator = intentCreator.get(intentId);
  if (creator !== undefined && creator !== fromId) {
    await answerCallbackQuery(callbackQueryId, "Only the user who created the intent can approve.");
    return;
  }
  if (action === "deny") {
    await backend.approvalDecision(approvalId, "DENY", String(fromId));
    await answerCallbackQuery(callbackQueryId, "Denied");
    await sendMessage(chatId, "Okay, cancelled.");
    await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
    return;
  }
  if (action === "approve") {
    await backend.approvalDecision(approvalId, "APPROVE", String(fromId));
    await answerCallbackQuery(callbackQueryId, "Approved");
    await sendMessage(chatId, "Approved. Issuing virtual card + starting checkout…");
    await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const intent = await backend.getIntent(intentId) as { intent?: { status: string }; result?: { status: string; summary?: string; artifacts?: { url: string }[] } };
      const s = intent.intent?.status;
      if (s === "DONE") {
        const res = intent.result;
        let msg = `Order placed. (intent: <code>${intentId}</code>)`;
        if (res?.summary) msg += `\n${res.summary}`;
        if (res?.artifacts?.length) msg += `\nScreenshots: ${res.artifacts.map((a: { url: string }) => a.url).join(", ")}`;
        await sendMessage(chatId, msg);
        return;
      }
      if (s === "FAILED" || s === "DENIED") {
        await sendMessage(chatId, `Checkout ${s}. (intent: <code>${intentId}</code>)`);
        return;
      }
    }
    await sendMessage(chatId, `Still in progress. Use /status ${intentId} to check later.`);
  }
}
