-- Step 1: Add price column as nullable first
ALTER TABLE "Tournament" ADD COLUMN "price" INTEGER;

-- Step 2: Update existing records with a default price value (0)
UPDATE "Tournament" SET "price" = 0 WHERE "price" IS NULL;

-- Step 3: Make price column NOT NULL
ALTER TABLE "Tournament" ALTER COLUMN "price" SET NOT NULL;

-- Step 4: Add prizePool column as nullable
ALTER TABLE "Tournament" ADD COLUMN "prizePool" INTEGER;
