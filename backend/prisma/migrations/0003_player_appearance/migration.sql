-- AlterTable: cosmetic appearance presets (skin / hair / suit recolor keys)
ALTER TABLE "User" ADD COLUMN "skinTone" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "User" ADD COLUMN "hairColor" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "User" ADD COLUMN "suitColor" TEXT NOT NULL DEFAULT 'default';
