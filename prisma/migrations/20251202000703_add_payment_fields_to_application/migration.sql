-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "isPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receiptImageUrl" TEXT;

