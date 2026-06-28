-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('DEPOSIT', 'WITHDRAW', 'BET_DEBIT', 'BET_CREDIT', 'ADJUST');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('ROULETTE', 'BLACKJACK', 'SLOTS');

-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('PLACED', 'WON', 'LOST', 'PUSH', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RoundPhase" AS ENUM ('BETTING', 'SPINNING', 'SETTLED');

-- CreateEnum
CREATE TYPE "BjState" AS ENUM ('WAITING', 'DEALING', 'PLAYER_TURNS', 'DEALER_TURN', 'SETTLED');

-- CreateEnum
CREATE TYPE "HandResult" AS ENUM ('PENDING', 'WIN', 'LOSE', 'PUSH', 'BLACKJACK', 'BUST', 'SURRENDER');

-- CreateEnum
CREATE TYPE "ChatScope" AS ENUM ('GLOBAL', 'NEARBY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar" TEXT NOT NULL DEFAULT 'Actor1-0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balance" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "authNonce" TEXT,
    "authNonceExp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TxType" NOT NULL,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "amount" BIGINT NOT NULL,
    "onchainSig" TEXT,
    "idempotencyKey" TEXT,
    "meta" JSONB,
    "betId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameType" "GameType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "payout" BIGINT NOT NULL DEFAULT 0,
    "status" "BetStatus" NOT NULL DEFAULT 'PLACED',
    "gameRoundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FairnessRound" (
    "id" TEXT NOT NULL,
    "gameType" "GameType" NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "revealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FairnessRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouletteGame" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "phase" "RoundPhase" NOT NULL DEFAULT 'BETTING',
    "fairnessId" TEXT,
    "resultNumber" INTEGER,
    "resultColor" TEXT,
    "bettingEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "RouletteGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouletteBet" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "betType" TEXT NOT NULL,
    "selection" JSONB NOT NULL,
    "amount" BIGINT NOT NULL,
    "payout" BIGINT NOT NULL DEFAULT 0,
    "won" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouletteBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackjackGame" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "state" "BjState" NOT NULL DEFAULT 'WAITING',
    "fairnessId" TEXT,
    "dealerHand" JSONB,
    "shoe" JSONB,
    "turnIndex" INTEGER NOT NULL DEFAULT 0,
    "turnEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "BlackjackGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackjackHand" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "cards" JSONB NOT NULL DEFAULT '[]',
    "bet" BIGINT NOT NULL,
    "payout" BIGINT NOT NULL DEFAULT 0,
    "result" "HandResult" NOT NULL DEFAULT 'PENDING',
    "isStanding" BOOLEAN NOT NULL DEFAULT false,
    "isDoubled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlackjackHand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotSpin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "fairnessId" TEXT,
    "bet" BIGINT NOT NULL,
    "result" JSONB NOT NULL,
    "payout" BIGINT NOT NULL DEFAULT 0,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotSpin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "ChatScope" NOT NULL DEFAULT 'GLOBAL',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_refreshTokenHash_idx" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE INDEX "Wallet_address_idx" ON "Wallet"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_onchainSig_key" ON "Transaction"("onchainSig");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Bet_userId_idx" ON "Bet"("userId");

-- CreateIndex
CREATE INDEX "Bet_gameType_gameRoundId_idx" ON "Bet"("gameType", "gameRoundId");

-- CreateIndex
CREATE INDEX "FairnessRound_gameType_idx" ON "FairnessRound"("gameType");

-- CreateIndex
CREATE INDEX "FairnessRound_serverSeedHash_idx" ON "FairnessRound"("serverSeedHash");

-- CreateIndex
CREATE INDEX "RouletteGame_tableId_idx" ON "RouletteGame"("tableId");

-- CreateIndex
CREATE INDEX "RouletteGame_phase_idx" ON "RouletteGame"("phase");

-- CreateIndex
CREATE INDEX "RouletteBet_gameId_idx" ON "RouletteBet"("gameId");

-- CreateIndex
CREATE INDEX "RouletteBet_userId_idx" ON "RouletteBet"("userId");

-- CreateIndex
CREATE INDEX "BlackjackGame_tableId_idx" ON "BlackjackGame"("tableId");

-- CreateIndex
CREATE INDEX "BlackjackGame_state_idx" ON "BlackjackGame"("state");

-- CreateIndex
CREATE INDEX "BlackjackHand_gameId_idx" ON "BlackjackHand"("gameId");

-- CreateIndex
CREATE INDEX "BlackjackHand_userId_idx" ON "BlackjackHand"("userId");

-- CreateIndex
CREATE INDEX "SlotSpin_userId_idx" ON "SlotSpin"("userId");

-- CreateIndex
CREATE INDEX "SlotSpin_machineId_idx" ON "SlotSpin"("machineId");

-- CreateIndex
CREATE INDEX "ChatMessage_scope_createdAt_idx" ON "ChatMessage"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_idx" ON "ChatMessage"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouletteBet" ADD CONSTRAINT "RouletteBet_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "RouletteGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouletteBet" ADD CONSTRAINT "RouletteBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlackjackHand" ADD CONSTRAINT "BlackjackHand_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "BlackjackGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlackjackHand" ADD CONSTRAINT "BlackjackHand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotSpin" ADD CONSTRAINT "SlotSpin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

