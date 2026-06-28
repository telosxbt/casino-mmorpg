-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- AlterTable: player profile (username chosen at first login + gender-based avatar)
ALTER TABLE "User" ALTER COLUMN "avatar" SET DEFAULT 'male';
ALTER TABLE "User" ADD COLUMN "gender" "Gender";
ALTER TABLE "User" ADD COLUMN "profileComplete" BOOLEAN NOT NULL DEFAULT false;
