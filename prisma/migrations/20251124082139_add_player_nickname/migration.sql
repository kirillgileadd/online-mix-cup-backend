-- Add nickname column temporarily allowing NULL
ALTER TABLE "Player" ADD COLUMN "nickname" TEXT;

-- Try to backfill nickname from related applications (if exists)
UPDATE "Player" p
SET "nickname" = COALESCE(
  (
    SELECT a."nickname"
    FROM "Application" a
    WHERE a."userId" = p."userId"
      AND a."tournamentId" = p."tournamentId"
      AND a."nickname" IS NOT NULL AND a."nickname" <> ''
    ORDER BY a."createdAt" DESC
    LIMIT 1
  ),
  COALESCE(
    (
      SELECT u."username"
      FROM "User" u
      WHERE u."id" = p."userId"
    ),
    'Player_' || p."id"
  )
);

-- Make column required and ensure no NULL values remain
ALTER TABLE "Player"
  ALTER COLUMN "nickname" SET NOT NULL;
