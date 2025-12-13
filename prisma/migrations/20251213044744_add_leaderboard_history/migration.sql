-- CreateTable
CREATE TABLE "LeaderboardHistory" (
    "id" SERIAL NOT NULL,
    "leaderboardId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaderboardHistory_leaderboardId_idx" ON "LeaderboardHistory"("leaderboardId");

-- CreateIndex
CREATE INDEX "LeaderboardHistory_userId_idx" ON "LeaderboardHistory"("userId");

-- CreateIndex
CREATE INDEX "LeaderboardHistory_createdAt_idx" ON "LeaderboardHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "LeaderboardHistory" ADD CONSTRAINT "LeaderboardHistory_leaderboardId_fkey" FOREIGN KEY ("leaderboardId") REFERENCES "Leaderboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

