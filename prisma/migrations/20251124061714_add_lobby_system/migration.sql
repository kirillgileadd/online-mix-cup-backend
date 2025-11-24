/*
  Warnings:

  - Made the column `chillZoneValue` on table `Player` required. This step will fail if there are existing NULL values in that column.
  - Made the column `lives` on table `Player` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "LobbyStatus" AS ENUM ('PENDING', 'DRAFTING', 'PLAYING', 'FINISHED');

-- CreateEnum
CREATE TYPE "ParticipationResult" AS ENUM ('WIN', 'LOSS', 'NONE');

-- Update existing NULL values before making columns required
UPDATE "Player" SET "chillZoneValue" = 0 WHERE "chillZoneValue" IS NULL;
UPDATE "Player" SET "lives" = 3 WHERE "lives" IS NULL;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN "mmr" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "Player" ALTER COLUMN "chillZoneValue" SET NOT NULL;
ALTER TABLE "Player" ALTER COLUMN "chillZoneValue" SET DEFAULT 0;
ALTER TABLE "Player" ALTER COLUMN "lives" SET NOT NULL;
ALTER TABLE "Player" ALTER COLUMN "lives" SET DEFAULT 3;

-- CreateTable
CREATE TABLE "Lobby" (
    "id" SERIAL NOT NULL,
    "round" INTEGER NOT NULL,
    "status" "LobbyStatus" NOT NULL DEFAULT 'PENDING',
    "tournamentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participation" (
    "id" SERIAL NOT NULL,
    "lobbyId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "team" INTEGER,
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "pickedAt" TIMESTAMP(3),
    "result" "ParticipationResult",

    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Participation_playerId_lobbyId_key" ON "Participation"("playerId", "lobbyId");

-- AddForeignKey
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
