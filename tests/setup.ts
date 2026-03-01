// Global Jest setup — runs before every test file regardless of how jest is invoked.
// This ensures TELEGRAM_MOCK is always active in tests, preventing accidental
// real Telegram API calls even when jest is run directly (npx jest, IDE runners, etc.)
process.env.TELEGRAM_MOCK = 'true';
