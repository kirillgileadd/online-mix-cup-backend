/*
  Warnings:

  - The `eventDate` column on the `Tournament` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Tournament" DROP COLUMN "eventDate",
ADD COLUMN     "eventDate" TIMESTAMP(3);
