-- AlterTable
ALTER TABLE "Leaderboard" ADD COLUMN "rank" INTEGER;

-- CreateIndex
CREATE INDEX "Leaderboard_rank_idx" ON "Leaderboard"("rank");

-- Обновляем rank для всех существующих записей
-- Ранг вычисляется как количество записей с большим количеством очков + 1
-- Проверяем, есть ли записи в таблице перед обновлением
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Leaderboard" LIMIT 1) THEN
    WITH ranked_leaderboard AS (
      SELECT 
        id,
        ROW_NUMBER() OVER (ORDER BY points DESC, id ASC) as calculated_rank
      FROM "Leaderboard"
    )
    UPDATE "Leaderboard" l
    SET "rank" = r.calculated_rank
    FROM ranked_leaderboard r
    WHERE l.id = r.id;
  END IF;
END $$;

