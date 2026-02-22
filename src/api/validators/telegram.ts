import { z } from 'zod';

export const linkTelegramSchema = z.object({
  telegramChatId: z.string().min(1),
});

export type LinkTelegramInput = z.infer<typeof linkTelegramSchema>;
