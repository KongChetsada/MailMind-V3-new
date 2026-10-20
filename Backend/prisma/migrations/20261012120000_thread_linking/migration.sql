-- CreateEnum
CREATE TYPE "ActionRelation" AS ENUM ('DETAIL', 'RESCHEDULE');

-- AlterEnum
ALTER TYPE "ActionStatus" ADD VALUE 'MERGED';

-- AlterTable
ALTER TABLE "ActionItem" ADD COLUMN     "relatedActionId" TEXT,
ADD COLUMN     "relation" "ActionRelation";

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_relatedActionId_fkey" FOREIGN KEY ("relatedActionId") REFERENCES "ActionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

