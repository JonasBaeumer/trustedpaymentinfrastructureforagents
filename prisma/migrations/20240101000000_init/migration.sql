-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('RECEIVED', 'SEARCHING', 'QUOTED', 'AWAITING_APPROVAL', 'APPROVED', 'CARD_ISSUED', 'CHECKOUT_RUNNING', 'DONE', 'FAILED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('RESERVE', 'SETTLE', 'RETURN');

-- CreateEnum
CREATE TYPE "PotStatus" AS ENUM ('ACTIVE', 'SETTLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVED', 'DENIED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mainBalance" INTEGER NOT NULL DEFAULT 0,
    "maxBudgetPerIntent" INTEGER NOT NULL DEFAULT 50000,
    "merchantAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mccAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "maxBudget" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'gbp',
    "status" "IntentStatus" NOT NULL DEFAULT 'RECEIVED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualCard" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "stripeCardId" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "revealedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'gbp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "reservedAmount" INTEGER NOT NULL,
    "settledAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "PotStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "decision" "ApprovalDecisionType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseIntent_idempotencyKey_key" ON "PurchaseIntent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualCard_intentId_key" ON "VirtualCard"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualCard_stripeCardId_key" ON "VirtualCard"("stripeCardId");

-- CreateIndex
CREATE UNIQUE INDEX "Pot_intentId_key" ON "Pot"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_intentId_key" ON "ApprovalDecision"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_key_key" ON "IdempotencyRecord"("key");

-- AddForeignKey
ALTER TABLE "PurchaseIntent" ADD CONSTRAINT "PurchaseIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualCard" ADD CONSTRAINT "VirtualCard_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PurchaseIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PurchaseIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pot" ADD CONSTRAINT "Pot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pot" ADD CONSTRAINT "Pot_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PurchaseIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PurchaseIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PurchaseIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
