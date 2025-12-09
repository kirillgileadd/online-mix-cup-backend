-- Обновляем все слоты: уменьшаем на 1 (1-5 -> 0-4)
-- Это нужно для перехода на индексацию с 0, как в массивах
-- Используем временное значение для избежания конфликтов уникальности

-- Временно удаляем уникальное ограничение
ALTER TABLE "Participation" DROP CONSTRAINT IF EXISTS "Participation_teamId_slot_key";

-- Обновляем слоты через временное значение (добавляем 100, чтобы избежать конфликтов)
UPDATE "Participation"
SET "slot" = "slot" + 100
WHERE "slot" IS NOT NULL AND "slot" > 0;

-- Теперь уменьшаем на 101 (100 + 1), чтобы получить 0-4
UPDATE "Participation"
SET "slot" = "slot" - 101
WHERE "slot" IS NOT NULL AND "slot" >= 100;

-- Ограничение будет восстановлено автоматически при следующей синхронизации схемы Prisma

