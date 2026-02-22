import { Bot } from 'grammy';
import { env } from '@/config/env';

let _bot: Bot | null = null;

export function getTelegramBot(): Bot {
  if (!_bot) {
    if (!env.TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    _bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  }
  return _bot;
}
