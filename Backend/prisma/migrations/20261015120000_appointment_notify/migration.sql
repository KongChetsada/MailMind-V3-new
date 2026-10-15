-- AlterTable
ALTER TABLE "UserSetting" ADD COLUMN     "notifyNewAppointments" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "notifiedAt" TIMESTAMP(3);
