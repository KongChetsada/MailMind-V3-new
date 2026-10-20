-- AlterEnum
ALTER TYPE "AnalysisStatus" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "MailAccount" ADD COLUMN     "backfillCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "backfillCursor" TIMESTAMP(3),
ADD COLUMN     "backfillDoneAt" TIMESTAMP(3),
ADD COLUMN     "backfillError" TEXT,
ADD COLUMN     "backfillStartedAt" TIMESTAMP(3);
