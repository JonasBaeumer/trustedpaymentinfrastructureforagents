// Mock prisma
jest.mock('@/db/client', () => ({
  prisma: {
    pairingCode: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      create: jest.fn(),
    },
  },
}));

// Mock Telegram bot
const mockSendMessage = jest.fn().mockResolvedValue({ message_id: 1 });
jest.mock('@/telegram/telegramClient', () => ({
  getTelegramBot: () => ({ api: { sendMessage: mockSendMessage } }),
}));

// Mock session store
const mockGetSession = jest.fn();
const mockSetSession = jest.fn();
const mockClearSession = jest.fn();
jest.mock('@/telegram/sessionStore', () => ({
  getSignupSession: (...args: any[]) => mockGetSession(...args),
  setSignupSession: (...args: any[]) => mockSetSession(...args),
  clearSignupSession: (...args: any[]) => mockClearSession(...args),
}));

import { handleTelegramMessage } from '@/telegram/signupHandler';
import { prisma } from '@/db/client';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const chatId = 12345678;

function makeUpdate(text: string) {
  return {
    update_id: 1,
    message: { message_id: 1, chat: { id: chatId }, text },
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  mockSetSession.mockResolvedValue(undefined);
  mockClearSession.mockResolvedValue(undefined);
});

describe('/start <code> handling', () => {
  it('replies with welcome prompt when code is valid', async () => {
    const future = new Date(Date.now() + 60_000);
    (mockPrisma.pairingCode.findUnique as jest.Mock).mockResolvedValue({
      code: 'ABCD1234',
      agentId: 'ag_test',
      claimedByUserId: null,
      expiresAt: future,
    });

    await handleTelegramMessage(makeUpdate('/start ABCD1234'));

    expect(mockSetSession).toHaveBeenCalledWith(chatId, {
      step: 'awaiting_email',
      agentId: 'ag_test',
      pairingCode: 'ABCD1234',
    });
    expect(mockSendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('email'));
  });

  it('normalises code to uppercase', async () => {
    const future = new Date(Date.now() + 60_000);
    (mockPrisma.pairingCode.findUnique as jest.Mock).mockResolvedValue({
      code: 'ABCD1234',
      agentId: 'ag_test',
      claimedByUserId: null,
      expiresAt: future,
    });

    await handleTelegramMessage(makeUpdate('/start abcd1234'));

    expect(mockPrisma.pairingCode.findUnique).toHaveBeenCalledWith({ where: { code: 'ABCD1234' } });
  });

  it('replies with error when code not found', async () => {
    (mockPrisma.pairingCode.findUnique as jest.Mock).mockResolvedValue(null);

    await handleTelegramMessage(makeUpdate('/start BADCODE'));

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('not found'));
  });

  it('replies with error when code is expired', async () => {
    (mockPrisma.pairingCode.findUnique as jest.Mock).mockResolvedValue({
      code: 'EXPIRED1',
      agentId: 'ag_test',
      claimedByUserId: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    await handleTelegramMessage(makeUpdate('/start EXPIRED1'));

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('expired'));
  });

  it('replies with error when code already claimed', async () => {
    (mockPrisma.pairingCode.findUnique as jest.Mock).mockResolvedValue({
      code: 'CLAIMED1',
      agentId: 'ag_test',
      claimedByUserId: 'user-existing',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await handleTelegramMessage(makeUpdate('/start CLAIMED1'));

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('already been used'));
  });

  it('sends generic instructions when /start has no code', async () => {
    await handleTelegramMessage(makeUpdate('/start'));

    expect(mockPrisma.pairingCode.findUnique).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('pairing code'));
  });
});

describe('email step handling', () => {
  const validSession = { step: 'awaiting_email' as const, agentId: 'ag_test', pairingCode: 'ABCD1234' };

  it('creates user and marks code claimed on valid email', async () => {
    mockGetSession.mockResolvedValue(validSession);
    (mockPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-new', email: 'alice@example.com' });
    (mockPrisma.pairingCode.update as jest.Mock).mockResolvedValue({});

    await handleTelegramMessage(makeUpdate('alice@example.com'));

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'alice@example.com',
          telegramChatId: chatId.toString(),
          agentId: 'ag_test',
          mainBalance: 1_000_000,
          maxBudgetPerIntent: 50000,
        }),
      }),
    );
    expect(mockPrisma.pairingCode.update).toHaveBeenCalledWith({
      where: { code: 'ABCD1234' },
      data: { claimedByUserId: 'user-new' },
    });
    expect(mockClearSession).toHaveBeenCalledWith(chatId);
    expect(mockSendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('✅'));
  });

  it('normalises email to lowercase', async () => {
    mockGetSession.mockResolvedValue(validSession);
    (mockPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-new', email: 'alice@example.com' });
    (mockPrisma.pairingCode.update as jest.Mock).mockResolvedValue({});

    await handleTelegramMessage(makeUpdate('Alice@EXAMPLE.COM'));

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'alice@example.com' }) }),
    );
  });

  it('rejects invalid email and does not create user', async () => {
    mockGetSession.mockResolvedValue(validSession);

    await handleTelegramMessage(makeUpdate('not-an-email'));

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('valid email'));
  });

  it('handles duplicate email gracefully', async () => {
    mockGetSession.mockResolvedValue(validSession);
    const err = new Error('Unique constraint') as any;
    err.code = 'P2002';
    (mockPrisma.user.create as jest.Mock).mockRejectedValue(err);

    await handleTelegramMessage(makeUpdate('existing@example.com'));

    expect(mockSendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('already exists'));
  });

  it('prompts to /start if no session exists', async () => {
    mockGetSession.mockResolvedValue(null);

    await handleTelegramMessage(makeUpdate('hello'));

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('/start'));
  });
});
