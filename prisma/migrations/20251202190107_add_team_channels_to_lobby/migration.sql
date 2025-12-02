-- AlterTable
ALTER TABLE "Lobby" ADD COLUMN     "team1ChannelId" TEXT,
ADD COLUMN     "team2ChannelId" TEXT;

-- AlterTable
ALTER TABLE "Player" ALTER COLUMN "gameRoles" DROP DEFAULT;
