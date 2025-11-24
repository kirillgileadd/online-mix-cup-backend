/*
  Warnings:

  - Added the required column `updatedAt` to the `Lobby` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Participation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Lobby" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
