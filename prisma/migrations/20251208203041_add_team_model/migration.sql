-- CreateTable
CREATE TABLE "Team" (
    "id" SERIAL NOT NULL,
    "lobbyId" INTEGER NOT NULL,
    "discordChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Team_lobbyId_idx" ON "Team"("lobbyId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Добавляем новые поля в Participation
ALTER TABLE "Participation" ADD COLUMN "teamId" INTEGER,
ADD COLUMN "slot" INTEGER;

-- Создаем индексы для новых полей
CREATE INDEX "Participation_teamId_idx" ON "Participation"("teamId");

-- Переносим данные: создаем Team для существующих лобби с каналами
-- Создаем Team 1 для team1ChannelId (используем порядок вставки для идентификации)
INSERT INTO "Team" ("lobbyId", "discordChannelId", "createdAt")
SELECT 
    "id" as "lobbyId",
    "team1ChannelId" as "discordChannelId",
    NOW() as "createdAt"
FROM "Lobby"
WHERE "team1ChannelId" IS NOT NULL;

-- Создаем Team 2 для team2ChannelId
INSERT INTO "Team" ("lobbyId", "discordChannelId", "createdAt")
SELECT 
    "id" as "lobbyId",
    "team2ChannelId" as "discordChannelId",
    NOW() as "createdAt"
FROM "Lobby"
WHERE "team2ChannelId" IS NOT NULL;

-- Обновляем Participation: связываем с Team на основе team (1 или 2)
-- Для team = 1: берем первую созданную Team для этого лобби (с team1ChannelId)
UPDATE "Participation" p
SET "teamId" = (
    SELECT t."id"
    FROM "Team" t
    INNER JOIN "Lobby" l ON t."lobbyId" = l."id"
    WHERE t."lobbyId" = p."lobbyId"
    AND t."discordChannelId" = l."team1ChannelId"
    ORDER BY t."id" ASC
    LIMIT 1
)
WHERE p."team" = 1;

-- Для team = 2: берем вторую созданную Team для этого лобби (с team2ChannelId)
UPDATE "Participation" p
SET "teamId" = (
    SELECT t."id"
    FROM "Team" t
    INNER JOIN "Lobby" l ON t."lobbyId" = l."id"
    WHERE t."lobbyId" = p."lobbyId"
    AND t."discordChannelId" = l."team2ChannelId"
    ORDER BY t."id" ASC
    LIMIT 1
)
WHERE p."team" = 2;

-- Устанавливаем slot для каждой команды отдельно
-- Для team = 1
WITH ranked_participations AS (
    SELECT 
        "id",
        "lobbyId",
        ROW_NUMBER() OVER (PARTITION BY "lobbyId" ORDER BY "id" ASC) as slot_num
    FROM "Participation"
    WHERE "team" = 1
)
UPDATE "Participation" p
SET "slot" = rp.slot_num
FROM ranked_participations rp
WHERE p."id" = rp."id";

-- Для team = 2
WITH ranked_participations AS (
    SELECT 
        "id",
        "lobbyId",
        ROW_NUMBER() OVER (PARTITION BY "lobbyId" ORDER BY "id" ASC) as slot_num
    FROM "Participation"
    WHERE "team" = 2
)
UPDATE "Participation" p
SET "slot" = rp.slot_num
FROM ranked_participations rp
WHERE p."id" = rp."id";

-- Добавляем внешний ключ для teamId
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Создаем уникальные индексы
CREATE UNIQUE INDEX "Participation_teamId_slot_key" ON "Participation"("teamId", "slot") WHERE "teamId" IS NOT NULL AND "slot" IS NOT NULL;

-- Удаляем старые поля из Lobby
ALTER TABLE "Lobby" DROP COLUMN "team1ChannelId",
DROP COLUMN "team2ChannelId";

-- Удаляем старое поле team из Participation (после переноса данных)
ALTER TABLE "Participation" DROP COLUMN "team";

