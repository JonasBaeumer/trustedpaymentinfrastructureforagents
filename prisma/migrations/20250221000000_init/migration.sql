-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('RECEIVED', 'SEARCHING', 'QUOTED', 'AWAITING_APPROVAL', 'APPROVED', 'CARD_ISSUED', 'CHECKOUT_RUNNING', 'DONE', 'FAILED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('AWAITING_APPROVAL', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('ISSUED', 'REVEALED', 'CLOSED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('SEARCH', 'CHECKOUT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "telegram_user_id" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseIntent" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "raw_text" TEXT NOT NULL,
    "status" "IntentStatus" NOT NULL DEFAULT 'RECEIVED',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "merchant_domain" TEXT NOT NULL,
    "mcc_hint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "scope_json" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pot" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',

    CONSTRAINT "Pot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pot_id" TEXT,
    "delta_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "stripe_card_id" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "brand" TEXT DEFAULT 'visa',
    "status" "CardStatus" NOT NULL DEFAULT 'ISSUED',
    "revealed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "constraints_json" TEXT NOT NULL,
    "pan_encrypted" TEXT,
    "exp_month" INTEGER,
    "exp_year" INTEGER,
    "cvc_encrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "bull_job_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Result" (
    "id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "artifacts_json" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegram_user_id_key" ON "User"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "StripeEvent_stripe_event_id_key" ON "StripeEvent"("stripe_event_id");

-- AddForeignKey
ALTER TABLE "PurchaseIntent" ADD CONSTRAINT "PurchaseIntent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "PurchaseIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "PurchaseIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pot" ADD CONSTRAINT "Pot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_pot_id_fkey" FOREIGN KEY ("pot_id") REFERENCES "Pot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "PurchaseIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "PurchaseIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "PurchaseIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "PurchaseIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
