-- AlterTable
ALTER TABLE "MailAccount" ADD COLUMN     "changeCursor" TEXT;

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "removedAt" TIMESTAMP(3);

