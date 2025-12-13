-- Add nickname column to User (nullable)
ALTER TABLE "User" ADD COLUMN "nickname" TEXT;

-- Migrate nickname from Player to User
-- For each user, take the first non-empty nickname from their players
UPDATE "User" u
SET "nickname" = (
  SELECT p."nickname"
  FROM "Player" p
  WHERE p."userId" = u."id"
    AND p."nickname" IS NOT NULL
    AND p."nickname" <> ''
  ORDER BY p."createdAt" ASC
  LIMIT 1
)
WHERE NOT EXISTS (
  SELECT 1
  FROM "User" u2
  WHERE u2."id" = u."id"
    AND u2."nickname" IS NOT NULL
);

-- If user still doesn't have nickname, try to get it from Application
UPDATE "User" u
SET "nickname" = (
  SELECT a."nickname"
  FROM "Application" a
  WHERE a."userId" = u."id"
    AND a."nickname" IS NOT NULL
    AND a."nickname" <> ''
  ORDER BY a."createdAt" ASC
  LIMIT 1
)
WHERE u."nickname" IS NULL;

-- If still no nickname, use username as fallback
UPDATE "User" u
SET "nickname" = u."username"
WHERE u."nickname" IS NULL
  AND u."username" IS NOT NULL
  AND u."username" <> '';

-- Drop nickname column from Player
ALTER TABLE "Player" DROP COLUMN "nickname";

